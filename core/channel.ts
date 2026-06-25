import type { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import { z } from 'zod';
import type { PubSubAdapter } from './adapters';
import type { CronJob } from './cron';
import { createChannelCron } from './cron';
import type { Schedule } from './cron';
import type { InferStores, MethodMap, StorageInstance } from './storage';
import type {
  BroadcastOptions,
  ChannelBroadcast,
  ChannelContext,
  ChannelMethodCtx,
  ClientMessage,
  ClientsAccessor,
  CronContext,
  DisconnectOptions,
  MetaAccessor,
  PubSubMessage,
  QuerySelector,
  RawContext,
  RealtimeChannel,
  ServerMessage,
} from './types';
import { isExcluded, matchesSelector, sendEvent } from './utils';
import { symbols } from './constants';

export interface ChannelInternals<TName extends string> {
  readonly pubsub: boolean;
  readonly jobs: readonly CronJob[];
  onConnect(raw: RawContext<TName>): Promise<void>;
  onMessage(raw: RawContext<TName>, data: unknown): Promise<void>;
  onDisconnect(raw: RawContext<TName>): Promise<void>;
  onError(raw: RawContext<TName>, err: Error): Promise<void>;
  handlePubSub(channelClients: Set<WebSocket>, msg: unknown): void;
}

// ── Public type ───────────────────────────────────────────────

export type Channel<
  TName extends string = string,
  TEmit = unknown,
  TReceive = unknown,
> = {
  readonly name: TName;
  readonly [symbols.emit]: TEmit;
  readonly [symbols.receive]: TReceive;
  readonly [symbols.channel]: ChannelInternals<TName>;
  clone<N extends string>(name: N): Channel<N, TEmit, TReceive>;
};

// ── Internal helpers ──────────────────────────────────────────

type AnyStore = StorageInstance<string, unknown, MethodMap>[];

function sendSystem(client: WebSocket, msg: ServerMessage): void {
  if (client.readyState !== WebSocket.OPEN) return;
  client.send(JSON.stringify(msg));
}

// ── channel() ────────────────────────────────────────────────

export function channel<
  TName extends string,
  TEmit,
  TReceive,
  TMeta extends Record<string, unknown> = Record<string, unknown>,
  TStores extends AnyStore | undefined = undefined,
  TMethodDefs extends MethodMap = Record<never, never>,
>(
  name: TName,
  def: {
    parameters: {
      emit: z.ZodType<TEmit>;
      receive: z.ZodType<TReceive>;
    };
    meta?: z.ZodType<TMeta>;
    stores?: TStores;
    pubsub?: boolean;
    methods?: (
      ctx: ChannelMethodCtx<TEmit, InferStores<TStores>, TMeta>,
    ) => TMethodDefs;
    events: {
      onConnect?(ctx: ChannelContext<TName, TEmit, InferStores<TStores>, TMeta>): void | Promise<void>;
      onMessage?(ctx: ChannelContext<TName, TEmit, InferStores<TStores>, TMeta>, payload: TReceive): void | Promise<void>;
      onDisconnect?(ctx: ChannelContext<TName, TEmit, InferStores<TStores>, TMeta>): void | Promise<void>;
      onError?(ctx: ChannelContext<TName, TEmit, InferStores<TStores>, TMeta>, err: Error): void | Promise<void>;
    };
  },
): RealtimeChannel<Channel<TName, TEmit, TReceive>, TMethodDefs> & {
  cron(
    cronName: string,
    schedule: Schedule,
    run: (ctx: CronContext<TName, TEmit, InferStores<TStores>, TMeta>) => void | Promise<void>,
    onError?: (ctx: CronContext<TName, TEmit, InferStores<TStores>, TMeta>, err: Error) => void | Promise<void>,
  ): void;
} {
  const pubsub = def.pubsub ?? false;

  // ── Stores ────────────────────────────────────────────────
  const storesMap: InferStores<TStores> = (() => {
    if (!def.stores || def.stores.length === 0)
      return Object.freeze({}) as InferStores<TStores>;
    return Object.freeze(
      Object.fromEntries(def.stores.map((s) => [s.storeName, s.methods])),
    ) as InferStores<TStores>;
  })();

  // ── Crons (dynamic, registered via .cron()) ───────────────
  const channelCrons: CronJob[] = [];

  // ── Server refs ───────────────────────────────────────────
  let serverRef: WebSocketServer | null = null;
  let adapterRef: PubSubAdapter | undefined;

  // ── Broadcast builder ─────────────────────────────────────
  function buildBroadcast(
    channelClients: () => Set<WebSocket>,
    senderId?: string,
  ): ChannelBroadcast<TEmit, TMeta> {
    const publish = (msg: PubSubMessage<TEmit>): void => {
      if (pubsub && adapterRef) void adapterRef.publish(name, msg);
    };

    return {
      all(data, opts) {
        for (const c of channelClients()) {
          if (c.readyState === WebSocket.OPEN && !isExcluded(opts, c)) sendEvent(c, data);
        }
        publish({ type: 'all', data, opts });
      },
      others(data, opts) {
        for (const c of channelClients()) {
          if (c.readyState === WebSocket.OPEN && c.id !== senderId && !isExcluded(opts, c))
            sendEvent(c, data);
        }
        publish({ type: 'others', sender: senderId, data, opts });
      },
      to(selector, data, opts) {
        for (const c of channelClients()) {
          if (c.readyState === WebSocket.OPEN && matchesSelector(selector as QuerySelector, c) && !isExcluded(opts, c))
            sendEvent(c, data);
        }
        publish({ type: 'to', selector: selector as QuerySelector, data, opts });
      },
      except(selector, data) {
        for (const c of channelClients()) {
          if (c.readyState === WebSocket.OPEN && !matchesSelector(selector as QuerySelector, c))
            sendEvent(c, data);
        }
        publish({ type: 'except', selector: selector as QuerySelector, data });
      },
      channel<TTargetEmit = unknown>(target: string) {
        return {
          all(data: TTargetEmit, opts?: BroadcastOptions) {
            if (!serverRef) return;
            broadcastToServer(serverRef, target, { type: 'all', data, opts });
            if (adapterRef) void adapterRef.publish(target, { type: 'all', data, opts });
          },
          to(selector: QuerySelector, data: TTargetEmit, opts?: BroadcastOptions) {
            if (!serverRef) return;
            broadcastToServer(serverRef, target, { type: 'to', selector, data, opts });
            if (adapterRef) void adapterRef.publish(target, { type: 'to', selector, data, opts });
          },
          except(selector: QuerySelector, data: TTargetEmit) {
            if (!serverRef) return;
            broadcastToServer(serverRef, target, { type: 'except', selector, data });
            if (adapterRef) void adapterRef.publish(target, { type: 'except', selector, data });
          },
        };
      },
    };
  }

  // ── Clients accessor ──────────────────────────────────────
  function buildClientsAccessor(channelClients: () => Set<WebSocket>): ClientsAccessor<TEmit, TMeta> {
    return {
      get size() { return channelClients().size; },
      find(selector) {
        const result: WebSocket[] = [];
        for (const c of channelClients()) {
          if (matchesSelector(selector as QuerySelector, c)) result.push(c);
        }
        return result;
      },
      send(selector, data) {
        const matched: WebSocket[] = [];
        for (const c of channelClients()) {
          if (matchesSelector(selector as QuerySelector, c)) { sendEvent(c, data); matched.push(c); }
        }
        return matched;
      },
      update(selector, patch) {
        const matched: WebSocket[] = [];
        for (const c of channelClients()) {
          if (matchesSelector(selector as QuerySelector, c)) {
            if (typeof patch === 'function') Object.assign(c.meta, patch(c.meta as TMeta));
            else Object.assign(c.meta, patch);
            matched.push(c);
          }
        }
        return matched;
      },
      disconnect(selector, opts) {
        const matched: WebSocket[] = [];
        for (const c of channelClients()) {
          if (matchesSelector(selector as QuerySelector, c)) {
            if (c.readyState === WebSocket.OPEN) c.close(opts?.code ?? 1000, opts?.reason ?? '');
            matched.push(c);
          }
        }
        return matched;
      },
    };
  }

  // ── Method context ────────────────────────────────────────
  const methodCtx: ChannelMethodCtx<TEmit, InferStores<TStores>, TMeta> = {
    stores: storesMap,
    get broadcast() {
      return buildBroadcast(() => getChannelClients(serverRef, name));
    },
  };

  const boundMethods = (def.methods?.(methodCtx) ?? {}) as TMethodDefs;

  // ── Context builder ───────────────────────────────────────
  function buildCtx(
    raw: RawContext<TName>,
    channelClients: () => Set<WebSocket>,
  ): ChannelContext<TName, TEmit, InferStores<TStores>, TMeta> {
    return {
      client: raw.client,
      params: raw.params,
      request: raw.request,
      channel: raw.channel,
      server: raw.server,
      stores: storesMap,

      meta: {
        set<K extends keyof TMeta & string>(
          keyOrUpdater: K | ((prev: TMeta) => TMeta),
          value?: TMeta[K],
        ) {
          if (typeof keyOrUpdater === 'function') {
            Object.assign(raw.client.meta, keyOrUpdater(raw.client.meta as TMeta));
          } else {
            raw.client.meta[keyOrUpdater] = value as TMeta[K];
          }
        },
        get: ((key: string, defaultValue?: unknown) => {
          const val = raw.client.meta[key];
          return val !== undefined ? val : defaultValue;
        }) as MetaAccessor<TMeta>['get'],
        get original(): TMeta {
          return raw.client.meta as TMeta;
        },
      },

      clients: buildClientsAccessor(channelClients),
      reply(data) { sendEvent(raw.client, data); },
      broadcast: buildBroadcast(channelClients, raw.client.id),
      disconnect(code = 1000, reason = '') { raw.client.close(code, reason); },
    };
  }

  // ── Internals ─────────────────────────────────────────────
  const channelInternals: ChannelInternals<TName> = {
    pubsub,
    jobs: channelCrons,

    async onConnect(raw) {
      if (!serverRef) {
        serverRef = raw.server;
        adapterRef = raw.adapter;
      }
      sendSystem(raw.client, { type: 'connected', id: raw.client.id });

      const clients = () => getChannelClients(raw.server, name);
      await def.events.onConnect?.(buildCtx(raw, clients));
    },

    async onMessage(raw, data) {
      if (!data || typeof data !== 'object' || (data as { type?: unknown }).type !== 'message') {
        sendSystem(raw.client, { type: 'error', reason: 'Invalid message format' });
        return;
      }

      const payload = (data as ClientMessage).data;
      const result = def.parameters.receive.safeParse(payload);

      if (!result.success) {
        sendSystem(raw.client, { type: 'error', reason: 'Validation failed', issues: result.error.issues });
        return;
      }

      const clients = () => getChannelClients(raw.server, name);
      await def.events.onMessage?.(buildCtx(raw, clients), result.data);
    },

    async onDisconnect(raw) {
      const clients = () => getChannelClients(raw.server, name);
      await def.events.onDisconnect?.(buildCtx(raw, clients));
    },

    async onError(raw, err) {
      const clients = () => getChannelClients(raw.server, name);
      await def.events.onError?.(buildCtx(raw, clients), err);
    },

    handlePubSub(channelClients, msg) {
      if (!msg || typeof msg !== 'object') return;
      const typed = msg as PubSubMessage;
      if (!typed.type) return;
      dispatchPubSub(channelClients, typed);
    },
  };

  // ── Returned channel object ───────────────────────────────
  return {
    methods: boundMethods,
    name,
    [symbols.emit]: undefined as unknown as TEmit,
    [symbols.receive]: undefined as unknown as TReceive,
    [symbols.channel]: channelInternals,

    cron(cronName, schedule, run, onError) {
      const job = createChannelCron<TName, TEmit, InferStores<TStores>, TMeta>({
        channelName: name,
        name: cronName,
        schedule,
        pubsub,
        stores: storesMap,
        getChannelClients: (server) => getChannelClients(server, name),
        serverRef: () => serverRef,
        adapterRef: () => adapterRef,
        run,
        onError,
      });
      channelCrons.push(job);
      if (serverRef) job[symbols.cron].start(serverRef, adapterRef);
    },

    clone<N extends string>(newName: N) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return channel(newName as any, def as any) as any;
    },
  };
}

// ── Helpers ───────────────────────────────────────────────────

function getChannelClients(
  server: WebSocketServer | null,
  channelName: string,
): Set<WebSocket> {
  if (!server) return new Set();
  const set = new Set<WebSocket>();
  server.clients.forEach((c) => {
    if (c.meta?.['channel'] === channelName) set.add(c);
  });
  return set;
}

function broadcastToServer(
  server: WebSocketServer,
  channelName: string,
  msg: PubSubMessage,
): void {
  server.clients.forEach((c) => {
    if (c.meta?.['channel'] !== channelName) return;
    if (c.readyState !== WebSocket.OPEN) return;
    switch (msg.type) {
      case 'all':
        if (!isExcluded(msg.opts, c)) sendEvent(c, msg.data);
        break;
      case 'to':
        if (msg.selector && matchesSelector(msg.selector, c) && !isExcluded(msg.opts, c))
          sendEvent(c, msg.data);
        break;
      case 'except':
        if (msg.selector && !matchesSelector(msg.selector, c)) sendEvent(c, msg.data);
        break;
    }
  });
}

function dispatchPubSub(channelClients: Set<WebSocket>, msg: PubSubMessage): void {
  for (const client of channelClients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    switch (msg.type) {
      case 'all':
        if (!isExcluded(msg.opts, client)) sendEvent(client, msg.data);
        break;
      case 'others':
        if (client.id !== msg.sender && !isExcluded(msg.opts, client)) sendEvent(client, msg.data);
        break;
      case 'to':
        if (msg.selector && matchesSelector(msg.selector, client) && !isExcluded(msg.opts, client))
          sendEvent(client, msg.data);
        break;
      case 'except':
        if (msg.selector && !matchesSelector(msg.selector, client)) sendEvent(client, msg.data);
        break;
    }
  }
}
