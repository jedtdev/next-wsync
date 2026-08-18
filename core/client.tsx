'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  ClientMessage,
  RouterEmit,
  RouterReceive,
  ServerMessage,
} from './types';

// ── Types ─────────────────────────────────────────────────────

export const ChannelStatus = {
  Connecting: 'connecting',
  Open: 'open',
  Closed: 'closed',
  Error: 'error',
  Reconnecting: 'reconnecting',
} as const;

export type ChannelStatus = (typeof ChannelStatus)[keyof typeof ChannelStatus];

type EventHandlers<TEmit> = {
  onMessage?: (data: TEmit) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (e: Event) => void;
  onConnect?: (id: string) => void;
  onReconnect?: (attempt: number) => void;
};

type PoolEntry = {
  socket: WebSocket | null;
  handlers: Set<EventHandlers<unknown>>;
  id: string | null;
};

type ConnectionOptions = {
  maxRetries?: number;
  protocols?: string | string[];
};

type WsyncCtxValue = {
  connect<TEmit>(
    channel: string,
    params: Record<string, string>,
    handlers: EventHandlers<TEmit>,
    options?: ConnectionOptions,
  ): void;
  disconnect<TEmit>(
    channel: string,
    params: Record<string, string>,
    handlers: EventHandlers<TEmit>,
  ): void;
  send<TReceive>(
    channel: string,
    params: Record<string, string>,
    data: TReceive,
  ): void;
};

interface UseWsyncOptions<TEmit> {
  parameters?: Record<string, string>;
  maxRetries?: number;
  protocols?: string | string[];
  events?: EventHandlers<TEmit>;
}

// ── Helpers ───────────────────────────────────────────────────

const utils = {
  poolKey(channel: string, params: Record<string, string>): string {
    const sorted = Object.entries(params).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    const qs = sorted
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    return qs ? `${channel}?${qs}` : channel;
  },

  url(base: string, channel: string, params: Record<string, string>): string {
    const qs = new URLSearchParams(params).toString();
    const suffix = `/${channel}${qs ? `?${qs}` : ''}`;
    if (/^wss?:\/\//i.test(base)) return `${base.replace(/\/$/, '')}${suffix}`;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const path = base.startsWith('/') ? base : `/${base}`;
    return `${proto}://${location.host}${path.replace(/\/$/, '')}${suffix}`;
  },

  parse(raw: string): ServerMessage | null {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && 'type' in parsed)
        return parsed as ServerMessage;
    } catch {
      /* ignore */
    }
    return null;
  },
};

const WsyncCtx = createContext<WsyncCtxValue | null>(null);

// ── createClient() ──────────────────────────────────────────

export function createClient<TRouter extends Record<string, { emit: unknown; receive: unknown }>>(url: string) {
  function NextWsyncProvider({ children }: { children: ReactNode }) {
    const pool = useRef(new Map<string, PoolEntry>());
    const reconnectAttempts = useRef(new Map<string, number>());
    const reconnectTimers = useRef(
      new Map<string, ReturnType<typeof setTimeout>>(),
    );
    const closedIntentionally = useRef(new Set<string>());
    const reconnectOptions = useRef(new Map<string, ConnectionOptions>());

    const establish = useCallback(
      (
        poolKey: string,
        channel: string,
        params: Record<string, string>,
        protocols?: string | string[],
      ): void => {
        const socket = new WebSocket(utils.url(url, channel, params), protocols);
        const existing = pool.current.get(poolKey);
        const entry: PoolEntry = {
          socket,
          handlers: existing?.handlers ?? new Set(),
          id: null,
        };
        pool.current.set(poolKey, entry);

        socket.onopen = () => {
          reconnectAttempts.current.delete(poolKey);
          entry.handlers.forEach((h) => h.onOpen?.());
        };

        socket.onclose = () => {
          entry.handlers.forEach((h) => h.onClose?.());
          if (closedIntentionally.current.has(poolKey)) {
            closedIntentionally.current.delete(poolKey);
            return;
          }
          if (entry.handlers.size === 0) return;

          const attempt = reconnectAttempts.current.get(poolKey) ?? 0;
          const opts = reconnectOptions.current.get(poolKey);
          if (attempt >= (opts?.maxRetries ?? Infinity)) return;

          const delay = Math.min(
            100 * Math.pow(2, attempt) + Math.random() * 100,
            30_000,
          );
          reconnectAttempts.current.set(poolKey, attempt + 1);
          entry.handlers.forEach((h) => h.onReconnect?.(attempt + 1));

          const timer = setTimeout(() => {
            reconnectTimers.current.delete(poolKey);
            establish(poolKey, channel, params, reconnectOptions.current.get(poolKey)?.protocols);
          }, delay);
          reconnectTimers.current.set(poolKey, timer);
        };

        socket.onerror = (e) => entry.handlers.forEach((h) => h.onError?.(e));

        socket.onmessage = (e: MessageEvent<string>) => {
          const msg = utils.parse(e.data);
          if (!msg) return;
          switch (msg.type) {
            case 'connected':
              entry.id = msg.id;
              entry.handlers.forEach((h) => h.onConnect?.(msg.id));
              break;
            case 'message':
              entry.handlers.forEach((h) => h.onMessage?.(msg.data));
              break;
            case 'error':
              console.error('[ws] server error:', msg.reason, msg.issues);
              break;
          }
        };
      },
      [],
    );

    const connect = useCallback(
      <TEmit,>(
        channel: string,
        params: Record<string, string>,
        handlers: EventHandlers<TEmit>,
        connOptions?: ConnectionOptions,
      ) => {
        const poolKey = utils.poolKey(channel, params);
        if (connOptions) reconnectOptions.current.set(poolKey, connOptions);

        const existing = pool.current.get(poolKey);
        if (existing) {
          existing.handlers.add(handlers as EventHandlers<unknown>);
          if (existing.id) handlers.onConnect?.(existing.id);
          if (existing.socket !== null && existing.socket.readyState < 2) return;
          if (!reconnectTimers.current.has(poolKey))
            establish(poolKey, channel, params, connOptions?.protocols);
          return;
        }

        pool.current.set(poolKey, {
          socket: null!,
          handlers: new Set([handlers as EventHandlers<unknown>]),
          id: null,
        });
        establish(poolKey, channel, params, connOptions?.protocols);
      },
      [establish],
    );

    const disconnect = useCallback(
      <TEmit,>(
        channel: string,
        params: Record<string, string>,
        handlers: EventHandlers<TEmit>,
      ) => {
        const poolKey = utils.poolKey(channel, params);
        const entry = pool.current.get(poolKey);
        if (!entry) return;
        entry.handlers.delete(handlers as EventHandlers<unknown>);
        if (entry.handlers.size > 0) return;

        const timer = reconnectTimers.current.get(poolKey);
        if (timer !== undefined) {
          clearTimeout(timer);
          reconnectTimers.current.delete(poolKey);
        }
        reconnectAttempts.current.delete(poolKey);
        reconnectOptions.current.delete(poolKey);
        closedIntentionally.current.add(poolKey);
        entry.socket?.close();
        pool.current.delete(poolKey);
      },
      [],
    );

    const send = useCallback(
      <TReceive,>(
        channel: string,
        params: Record<string, string>,
        data: TReceive,
      ) => {
        const poolKey = utils.poolKey(channel, params);
        const entry = pool.current.get(poolKey);
        if (entry?.socket?.readyState === WebSocket.OPEN) {
          const msg: ClientMessage<TReceive> = { type: 'message', data };
          entry.socket.send(JSON.stringify(msg));
        }
      },
      [],
    );

    return (
      <WsyncCtx.Provider value={{ connect, disconnect, send }}>
        {children}
      </WsyncCtx.Provider>
    );
  }

  function useWsync<TChannel extends keyof TRouter & string>(
    channel: TChannel,
    options: UseWsyncOptions<RouterEmit<TRouter, TChannel>> = {},
  ) {
    const ctx = useContext(WsyncCtx);
    if (!ctx) throw new Error('useWsync must be inside <NextWsyncProvider>');

    type TEmit = RouterEmit<TRouter, TChannel>;
    type TReceive = RouterReceive<TRouter, TChannel>;

    const [status, setStatus] = useState<ChannelStatus>(
      ChannelStatus.Connecting,
    );
    const [id, setId] = useState<string | null>(null);

    const optsRef = useRef(options);
    optsRef.current = options;

    const subscribersRef = useRef(new Set<(data: TEmit) => void>());

    const paramsSerial = Object.entries(options.parameters ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');

    useEffect(() => {
      const params = options.parameters ?? {};
      const handlers: EventHandlers<TEmit> = {
        onOpen() {
          setStatus(ChannelStatus.Open);
          optsRef.current.events?.onOpen?.();
        },
        onClose() {
          setStatus(ChannelStatus.Closed);
          setId(null);
          optsRef.current.events?.onClose?.();
        },
        onError(e) {
          setStatus(ChannelStatus.Error);
          optsRef.current.events?.onError?.(e);
        },
        onConnect(id) {
          setId(id);
          optsRef.current.events?.onConnect?.(id);
        },
        onMessage(data) {
          optsRef.current.events?.onMessage?.(data);
          subscribersRef.current.forEach((cb) => cb(data));
        },
        onReconnect(n) {
          setStatus(ChannelStatus.Reconnecting);
          setId(null);
          optsRef.current.events?.onReconnect?.(n);
        },
      };

      ctx.connect<TEmit>(channel, params, handlers, {
        maxRetries: options.maxRetries,
        protocols: options.protocols,
      });
      return () => ctx.disconnect<TEmit>(channel, params, handlers);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [channel, paramsSerial]);

    const send = useCallback(
      (data: TReceive) =>
        ctx.send<TReceive>(channel, optsRef.current.parameters ?? {}, data),
      [channel, ctx],
    );

    const subscribe = useCallback((cb: (data: TEmit) => void) => {
      subscribersRef.current.add(cb);
      return () => subscribersRef.current.delete(cb);
    }, []);

    return { send, status, id, subscribe } as const;
  }

  return { NextWsyncProvider, useWsync };
}
