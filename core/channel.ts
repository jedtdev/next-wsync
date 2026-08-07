import type { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import { z } from 'zod';
import type { PubSubAdapter } from './adapters';
import type { CronJob } from './cron';
import { createChannelCron } from './cron';
import type { InferStores, MethodMap, StorageInstance } from './storage';
import type {
  BroadcastOptions,
  ChannelBroadcast,
  ChannelContext,
  ClientMessage,
  ClientsAccessor,
  CronControl,
  DisconnectOptions,
  MetaAccessor,
  PubSubMessage,
  QuerySelector,
  RawContext,
  RealtimeChannel,
  ServerMessage,
} from './types';
import { isExcluded, matchesSelector, ReadonlyHeaders, ReadonlyRequestsCookies, sendEvent } from './utils';
import { symbols } from './constants';
import { scopeStorage, type WsyncScope } from './scope';
import { Logger } from './logger';

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
  TCrons extends Record<string, { schedule: string; run: () => void | Promise<void>; onError?: (err: Error) => void | Promise<void> }> = Record<never, never>,
>(
  name: TName,
  def: {
    schema?: {
      emit?: z.ZodType<TEmit>;
      receive?: z.ZodType<TReceive>;
      meta?: z.ZodType<TMeta>;
    };
    parameters?: {
      emit: z.ZodType<TEmit>;
      receive: z.ZodType<TReceive>;
    };
    meta?: z.ZodType<TMeta>;
    stores?: TStores;
    pubsub?: boolean;
    crons?: TCrons;
    methods?:
      | TMethodDefs
      | ((ctx: { stores: InferStores<TStores>; broadcast: ChannelBroadcast<TEmit, TMeta> }) => TMethodDefs);
    events?: {
      onConnect?(ctx: ChannelContext<TName, TEmit, InferStores<TStores>, TMeta>): void | Promise<void>;
      onMessage?(ctx: ChannelContext<TName, TEmit, InferStores<TStores>, TMeta>, payload: TReceive): void | Promise<void>;
      onDisconnect?(ctx: ChannelContext<TName, TEmit, InferStores<TStores>, TMeta>): void | Promise<void>;
      onError?(ctx: ChannelContext<TName, TEmit, InferStores<TStores>, TMeta>, err: Error): void | Promise<void>;
    };
  },
): RealtimeChannel<Channel<TName, TEmit, TReceive>, TMethodDefs, { [K in keyof TCrons & string]: CronControl }> & {
  on(event: 'connect', listener: (ctx: ChannelContext<TName, TEmit, InferStores<TStores>, TMeta>) => void | Promise<void>): () => void;
  on(event: 'message', listener: (payload: TReceive) => void | Promise<void>): () => void;
  on(event: 'disconnect', listener: (ctx: ChannelContext<TName, TEmit, InferStores<TStores>, TMeta>) => void | Promise<void>): () => void;
  on(event: 'error', listener: (err: Error) => void | Promise<void>): () => void;
} {
  const pubsub = def.pubsub ?? false;

  const receiveSchema = def.schema?.receive ?? def.parameters?.receive;
  if (!receiveSchema) {
    throw new Error(`Channel "${name}" requires a receive schema defined in schema or parameters.`);
  }

  // ── Stores ────────────────────────────────────────────────
  const storesMap: InferStores<TStores> = (() => {
    if (!def.stores || def.stores.length === 0)
      return Object.freeze({}) as InferStores<TStores>;
    return Object.freeze(
      Object.fromEntries(def.stores.map((s) => [s.storeName, s.methods])),
    ) as InferStores<TStores>;
  })();

  // ── Server & Adapter refs ─────────────────────────────────
  let serverRef: WebSocketServer | null = null;
  let adapterRef: PubSubAdapter | undefined;

  // ── Event Emitter ─────────────────────────────────────────
  const listeners = new Map<string, Set<(...args: any[]) => void | Promise<void>>>();

  function addListener(event: string, fn: (...args: any[]) => void | Promise<void>) {
    let set = listeners.get(event);
    if (!set) {
      set = new Set();
      listeners.set(event, set);
    }
    set.add(fn);
    return () => set?.delete(fn);
  }

  async function emitEvent(event: string, ...args: any[]) {
    const set = listeners.get(event);
    if (!set || set.size === 0) return;
    const promises = Array.from(set).map((fn) => Promise.resolve(fn(...args)));
    await Promise.all(promises);
  }

  // ── Broadcast builder ─────────────────────────────────────
  function buildBroadcast(
    channelClients: () => Set<WebSocket>,
    senderId?: string,
  ): ChannelBroadcast<TEmit, TMeta> {
    const publish = async (msg: PubSubMessage<TEmit>): Promise<void> => {
      if (pubsub && adapterRef) await adapterRef.publish(name, msg);
    };

    return {
      async all(data, opts) {
        for (const c of channelClients()) {
          if (c.readyState === WebSocket.OPEN && !isExcluded(opts, c)) sendEvent(c, data);
        }
        await publish({ type: 'all', data, opts });
      },
      async others(data, opts) {
        for (const c of channelClients()) {
          if (c.readyState === WebSocket.OPEN && c.id !== senderId && !isExcluded(opts, c))
            sendEvent(c, data);
        }
        await publish({ type: 'others', sender: senderId, data, opts });
      },
      async to(selector, data, opts) {
        for (const c of channelClients()) {
          if (c.readyState === WebSocket.OPEN && matchesSelector(selector as QuerySelector, c) && !isExcluded(opts, c))
            sendEvent(c, data);
        }
        await publish({ type: 'to', selector: selector as QuerySelector, data, opts });
      },
      async except(selector, data) {
        for (const c of channelClients()) {
          if (c.readyState === WebSocket.OPEN && !matchesSelector(selector as QuerySelector, c))
            sendEvent(c, data);
        }
        await publish({ type: 'except', selector: selector as QuerySelector, data });
      },
      channel<TTargetEmit = unknown>(target: string) {
        return {
          async all(data: TTargetEmit, opts?: BroadcastOptions) {
            if (!serverRef) return;
            broadcastToServer(serverRef, target, { type: 'all', data, opts });
            if (adapterRef) await adapterRef.publish(target, { type: 'all', data, opts });
          },
          async to(selector: QuerySelector, data: TTargetEmit, opts?: BroadcastOptions) {
            if (!serverRef) return;
            broadcastToServer(serverRef, target, { type: 'to', selector, data, opts });
            if (adapterRef) await adapterRef.publish(target, { type: 'to', selector, data, opts });
          },
          async except(selector: QuerySelector, data: TTargetEmit) {
            if (!serverRef) return;
            broadcastToServer(serverRef, target, { type: 'except', selector, data });
            if (adapterRef) await adapterRef.publish(target, { type: 'except', selector, data });
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

  // ── Crons ─────────────────────────────────────────────────
  const channelCronsJobs: CronJob[] = [];
  const cronControls: Record<string, CronControl> = {};

  if (def.crons) {
    for (const [cronName, cronDef] of Object.entries(def.crons)) {
      const job = createChannelCron<TName, TEmit, InferStores<TStores>, TMeta>({
        channelName: name,
        name: cronName,
        schedule: cronDef.schedule,
        pubsub,
        stores: storesMap,
        getChannelClients: (server) => getChannelClients(server, name),
        serverRef: () => serverRef,
        adapterRef: () => adapterRef,
        run: cronDef.run as any,
        onError: cronDef.onError as any,
      });
      channelCronsJobs.push(job);
      cronControls[cronName] = {
        start() {
          if (serverRef) job[symbols.cron].start(serverRef, adapterRef);
        },
        stop() {
          job[symbols.cron].stop();
        },
        async trigger() {
          if (serverRef) {
            const scope: WsyncScope = {
              client: undefined as any,
              request: undefined as any,
              channel: name,
              server: serverRef,
              params: new URLSearchParams(),
              stores: storesMap,
              meta: undefined as any,
              broadcast: buildBroadcast(() => getChannelClients(serverRef, name)),
              clients: buildClientsAccessor(() => getChannelClients(serverRef, name)) as any,
              crons: cronControls as any,
              cookies: new ReadonlyRequestsCookies(new Headers()),
              headers: new ReadonlyHeaders(new Headers()),
              log: Logger.create(name),
              reply: () => {},
              disconnect: () => {},
            };
            await scopeStorage.run(scope, async () => {
              await cronDef.run();
            });
          }
        },
        get running() {
          return job[symbols.cron].running;
        },
      };
    }
  }

  // ── Context builder ───────────────────────────────────────
  function buildScope(
    raw: RawContext<TName>,
    channelClients: () => Set<WebSocket>,
  ): WsyncScope<TName, TEmit, InferStores<TStores>, TMeta, any> {
    const cookies = new ReadonlyRequestsCookies(raw.request.headers);
    const headers = new ReadonlyHeaders(raw.request.headers);
    const broadcast = buildBroadcast(channelClients, raw.client.id);
    const clients = buildClientsAccessor(channelClients);

    const metaAccessor: MetaAccessor<TMeta> = {
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
    };

    const scopeLog = Logger.create(name);

    const ctxObj: ChannelContext<TName, TEmit, InferStores<TStores>, TMeta, any> = {
      client: raw.client,
      params: raw.params,
      request: raw.request,
      channel: raw.channel,
      server: raw.server,
      stores: storesMap,
      meta: metaAccessor,
      clients,
      crons: cronControls,
      cookies,
      headers,
      log: scopeLog,
      reply(data) { sendEvent(raw.client, data); },
      broadcast,
      disconnect(code = 1000, reason = '') { raw.client.close(code, reason); },
    };

    return {
      ...ctxObj,
      context: ctxObj,
    } as any;
  }

  // ── Methods ───────────────────────────────────────────────
  const methodCtx = {
    stores: storesMap,
    get broadcast() {
      return buildBroadcast(() => getChannelClients(serverRef, name));
    },
  };

  const boundMethods = (
    typeof def.methods === 'function' ? def.methods(methodCtx as any) : def.methods ?? {}
  ) as TMethodDefs;

  // ── Internals ─────────────────────────────────────────────
  const scopeLog = Logger.create(name);

  const channelInternals: ChannelInternals<TName> = {
    pubsub,
    jobs: channelCronsJobs,

    async onConnect(raw) {
      if (!serverRef) {
        serverRef = raw.server;
        adapterRef = raw.adapter;
      }
      sendSystem(raw.client, { type: 'connected', id: raw.client.id });

      const clients = () => getChannelClients(raw.server, name);
      const scope = buildScope(raw, clients);
      scopeLog.info(`Client ${raw.client.id} connected`);

      await scopeStorage.run(scope, async () => {
        await def.events?.onConnect?.(scope as any);
        await emitEvent('connect', scope as any);
      });
    },

    async onMessage(raw, data) {
      if (!data || typeof data !== 'object' || (data as { type?: unknown }).type !== 'message') {
        scopeLog.warn(`Invalid message format received from ${raw.client.id}`, data);
        sendSystem(raw.client, { type: 'error', reason: 'Invalid message format' });
        return;
      }

      const payload = (data as ClientMessage).data;
      const result = receiveSchema.safeParse(payload);

      if (!result.success) {
        scopeLog.warn(`Validation failed for message from ${raw.client.id}`, result.error.issues);
        sendSystem(raw.client, { type: 'error', reason: 'Validation failed', issues: result.error.issues });
        return;
      }

      scopeLog.debug(`Message received from ${raw.client.id}`, result.data);
      const clients = () => getChannelClients(raw.server, name);
      const scope = buildScope(raw, clients);

      await scopeStorage.run(scope, async () => {
        await def.events?.onMessage?.(scope as any, result.data as TReceive);
        await emitEvent('message', result.data as TReceive);
      });
    },

    async onDisconnect(raw) {
      scopeLog.info(`Client ${raw.client.id} disconnected`);
      const clients = () => getChannelClients(raw.server, name);
      const scope = buildScope(raw, clients);

      await scopeStorage.run(scope, async () => {
        await def.events?.onDisconnect?.(scope as any);
        await emitEvent('disconnect', scope as any);
      });
    },

    async onError(raw, err) {
      scopeLog.error(`Error on client ${raw.client.id}`, err);
      const clients = () => getChannelClients(raw.server, name);
      const scope = buildScope(raw, clients);

      await scopeStorage.run(scope, async () => {
        await def.events?.onError?.(scope as any, err);
        await emitEvent('error', err);
      });
    },

    handlePubSub(channelClients, msg) {
      if (!msg || typeof msg !== 'object') return;
      const typed = msg as PubSubMessage;
      if (!typed.type) return;
      dispatchPubSub(channelClients, typed);
    },
  };

  // ── Returned channel object ───────────────────────────────
  const resChannel = {
    methods: boundMethods,
    crons: cronControls as { [K in keyof TCrons & string]: CronControl },
    name,
    [symbols.emit]: undefined as unknown as TEmit,
    [symbols.receive]: undefined as unknown as TReceive,
    [symbols.channel]: channelInternals,

    on(event: string, listener: (...args: any[]) => void | Promise<void>) {
      return addListener(event, listener);
    },

    clone<N extends string>(newName: N) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return channel(newName as any, def as any) as any;
    },
  };

  return resChannel as any;
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
