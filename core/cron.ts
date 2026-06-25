import { Cron } from 'croner';
import WebSocket from 'ws';
import type { WebSocketServer } from 'ws';
import type { PubSubAdapter } from './adapters';
import type {
  BroadcastOptions,
  ClientsAccessor,
  CronBroadcast,
  CronContext,
  DisconnectOptions,
  QuerySelector,
} from './types';
import { isExcluded, matchesSelector, sendEvent } from './utils';
import { symbols } from './constants';

export type Schedule = {
  expression: string;
  tz?: string;
};

export interface CronJobLast {
  arguments: null;
  error: Error | null;
  timestamps: { started: Date; finished: Date; durationMs: number };
}

export interface CronInternals {
  channelName: string | null;
  pubsub: boolean;
  stores: unknown;
  start(server: WebSocketServer, adapter?: PubSubAdapter): void;
  stop(): void;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface CronJob<TName extends string = string, TEmit = unknown> {
  readonly name: TName;
  readonly [symbols.cron]: CronInternals;
  stop(): void;
  isRunning(): boolean;
  nextRun(): Date | null;
  last: CronJobLast | null;
}

// JobContext — only used by standalone cron(), not channel crons
export interface JobContext<TEmit, TStores> {
  server: WebSocketServer;
  channel: string | null;
  stores: TStores;
  broadcast: {
    all(data: TEmit, opts?: BroadcastOptions): void;
    to(selector: QuerySelector, data: TEmit, opts?: BroadcastOptions): void;
    except(selector: QuerySelector, data: TEmit): void;
  };
  stop(): void;
}

export type JobsAccess<T extends readonly CronJob[]> = T extends readonly []
  ? Record<never, never>
  : { [K in T[number] as K['name']]: K };

// ── Standalone cron() — for global jobs via wsync(options.jobs) ───

export function cron<
  TName extends string,
  TEmit = unknown,
  TStores = Record<never, never>,
>(
  name: TName,
  def: {
    schedule: Schedule;
    run(ctx: JobContext<TEmit, TStores>): void | Promise<void>;
    onError?(ctx: JobContext<TEmit, TStores>, err: Error): void | Promise<void>;
  },
): CronJob<TName, TEmit> {
  let cronInstance: Cron | null = null;
  let running = false;
  let serverRef: WebSocketServer | null = null;
  let adapterRef: PubSubAdapter | undefined;

  const internals: CronInternals = {
    channelName: null,
    pubsub: false,
    stores: {} as TStores,

    start(server, adapter) {
      if (cronInstance) return;
      serverRef = server;
      adapterRef = adapter;
      cronInstance = new Cron(
        def.schedule.expression,
        def.schedule.tz ? { timezone: def.schedule.tz } : undefined,
        safeRun,
      );
    },

    stop() {
      cronInstance?.stop();
      cronInstance = null;
    },
  };

  function buildContext(): JobContext<TEmit, TStores> {
    if (!serverRef) throw new Error(`[cron:${name}] job fired before server init`);
    const ch = internals.channelName;
    const server = serverRef;

    return {
      server,
      channel: ch,
      stores: internals.stores as TStores,
      stop() { internals.stop(); },
      broadcast: {
        all(data, opts) {
          for (const client of server.clients as Set<WebSocket>) {
            if (!ch || client.meta?.['channel'] === ch) {
              if (!isExcluded(opts, client)) sendEvent(client, data);
            }
          }
          if (internals.pubsub && ch && adapterRef) {
            void adapterRef.publish(ch, { type: 'all', data, opts });
          }
        },
        to(selector, data, opts) {
          for (const client of server.clients as Set<WebSocket>) {
            if ((!ch || client.meta?.['channel'] === ch) && matchesSelector(selector, client) && !isExcluded(opts, client))
              sendEvent(client, data);
          }
          if (internals.pubsub && ch && adapterRef) {
            void adapterRef.publish(ch, { type: 'to', selector, data, opts });
          }
        },
        except(selector, data) {
          for (const client of server.clients as Set<WebSocket>) {
            if (!ch || client.meta?.['channel'] === ch) {
              if (!matchesSelector(selector, client)) sendEvent(client, data);
            }
          }
          if (internals.pubsub && ch && adapterRef) {
            void adapterRef.publish(ch, { type: 'except', selector, data });
          }
        },
      },
    };
  }

  function safeRun(): void {
    if (running) return;
    running = true;
    const started = new Date();

    Promise.resolve()
      .then(() => def.run(buildContext()))
      .then(() => {
        const finished = new Date();
        job.last = {
          arguments: null,
          error: null,
          timestamps: { started, finished, durationMs: finished.getTime() - started.getTime() },
        };
      })
      .catch((err: unknown) => {
        const finished = new Date();
        const error = err instanceof Error ? err : new Error(String(err));
        job.last = {
          arguments: null,
          error,
          timestamps: { started, finished, durationMs: finished.getTime() - started.getTime() },
        };
        if (def.onError) {
          try { void Promise.resolve(def.onError(buildContext(), error)); } catch { /* protect loop */ }
        }
        console.error(`[cron:${name}]`, error);
      })
      .finally(() => { running = false; });
  }

  const job: CronJob<TName, TEmit> = {
    name,
    [symbols.cron]: internals,
    last: null,
    stop() { cronInstance?.stop(); cronInstance = null; },
    isRunning() { return cronInstance !== null; },
    nextRun() { return cronInstance?.nextRun() ?? null; },
  };

  return job;
}

// ── createChannelCron() — used internally by channel().cron() ─────

export function createChannelCron<
  TName extends string,
  TEmit,
  TStores,
  TMeta extends Record<string, unknown>,
>(opts: {
  channelName: TName;
  name: string;
  schedule: Schedule;
  pubsub: boolean;
  stores: TStores;
  getChannelClients(server: WebSocketServer): Set<WebSocket>;
  serverRef(): WebSocketServer | null;
  adapterRef(): PubSubAdapter | undefined;
  run(ctx: CronContext<TName, TEmit, TStores, TMeta>): void | Promise<void>;
  onError?(ctx: CronContext<TName, TEmit, TStores, TMeta>, err: Error): void | Promise<void>;
}): CronJob {
  let cronInstance: Cron | null = null;
  let running = false;

  function buildClientsAccessor(server: WebSocketServer): ClientsAccessor<TEmit, TMeta> {
    const pool = () => opts.getChannelClients(server);
    return {
      get size() { return pool().size; },
      find(selector) {
        const result: WebSocket[] = [];
        for (const c of pool()) if (matchesSelector(selector as QuerySelector, c)) result.push(c);
        return result;
      },
      send(selector, data) {
        const matched: WebSocket[] = [];
        for (const c of pool()) {
          if (matchesSelector(selector as QuerySelector, c)) { sendEvent(c, data); matched.push(c); }
        }
        return matched;
      },
      update(selector, patch) {
        const matched: WebSocket[] = [];
        for (const c of pool()) {
          if (matchesSelector(selector as QuerySelector, c)) {
            if (typeof patch === 'function') Object.assign(c.meta, patch(c.meta as TMeta));
            else Object.assign(c.meta, patch);
            matched.push(c);
          }
        }
        return matched;
      },
      disconnect(selector, disconnectOpts) {
        const matched: WebSocket[] = [];
        for (const c of pool()) {
          if (matchesSelector(selector as QuerySelector, c)) {
            if (c.readyState === WebSocket.OPEN) c.close(disconnectOpts?.code ?? 1000, disconnectOpts?.reason ?? '');
            matched.push(c);
          }
        }
        return matched;
      },
    };
  }

  function buildBroadcast(server: WebSocketServer): CronBroadcast<TEmit, TMeta> {
    const pool = () => opts.getChannelClients(server);
    const ch = opts.channelName;

    return {
      all(data, broadcastOpts) {
        for (const c of pool()) {
          if (c.readyState === WebSocket.OPEN && !isExcluded(broadcastOpts, c)) sendEvent(c, data);
        }
        const adp = opts.adapterRef();
        if (opts.pubsub && adp) void adp.publish(ch, { type: 'all', data, opts: broadcastOpts });
      },
      to(selector, data, broadcastOpts) {
        for (const c of pool()) {
          if (c.readyState === WebSocket.OPEN && matchesSelector(selector as QuerySelector, c) && !isExcluded(broadcastOpts, c))
            sendEvent(c, data);
        }
        const adp = opts.adapterRef();
        if (opts.pubsub && adp) void adp.publish(ch, { type: 'to', selector: selector as QuerySelector, data, opts: broadcastOpts });
      },
      except(selector, data) {
        for (const c of pool()) {
          if (c.readyState === WebSocket.OPEN && !matchesSelector(selector as QuerySelector, c)) sendEvent(c, data);
        }
        const adp = opts.adapterRef();
        if (opts.pubsub && adp) void adp.publish(ch, { type: 'except', selector: selector as QuerySelector, data });
      },
      channel(targetName) {
        return {
          all(data, broadcastOpts) {
            const srv = opts.serverRef();
            if (!srv) return;
            for (const c of srv.clients as Set<WebSocket>) {
              if (c.meta?.['channel'] === targetName && c.readyState === WebSocket.OPEN && !isExcluded(broadcastOpts, c))
                sendEvent(c, data);
            }
            const adp = opts.adapterRef();
            if (adp) void adp.publish(targetName, { type: 'all', data, opts: broadcastOpts });
          },
          to(selector, data, broadcastOpts) {
            const srv = opts.serverRef();
            if (!srv) return;
            for (const c of srv.clients as Set<WebSocket>) {
              if (c.meta?.['channel'] === targetName && matchesSelector(selector, c) && !isExcluded(broadcastOpts, c))
                sendEvent(c, data);
            }
            const adp = opts.adapterRef();
            if (adp) void adp.publish(targetName, { type: 'to', selector, data, opts: broadcastOpts });
          },
          except(selector, data) {
            const srv = opts.serverRef();
            if (!srv) return;
            for (const c of srv.clients as Set<WebSocket>) {
              if (c.meta?.['channel'] === targetName && !matchesSelector(selector, c))
                sendEvent(c, data);
            }
            const adp = opts.adapterRef();
            if (adp) void adp.publish(targetName, { type: 'except', selector, data });
          },
        };
      },
    };
  }

  function buildContext(server: WebSocketServer): CronContext<TName, TEmit, TStores, TMeta> {
    return {
      channel: opts.channelName,
      stores: opts.stores,
      clients: buildClientsAccessor(server),
      broadcast: buildBroadcast(server),
      stop() { internals.stop(); },
    };
  }

  function safeRun(): void {
    const server = opts.serverRef();
    if (running || !server) return;
    running = true;
    const started = new Date();

    Promise.resolve()
      .then(() => opts.run(buildContext(server)))
      .then(() => {
        const finished = new Date();
        job.last = { arguments: null, error: null, timestamps: { started, finished, durationMs: finished.getTime() - started.getTime() } };
      })
      .catch((err: unknown) => {
        const finished = new Date();
        const error = err instanceof Error ? err : new Error(String(err));
        job.last = { arguments: null, error, timestamps: { started, finished, durationMs: finished.getTime() - started.getTime() } };
        if (opts.onError) {
          try { void Promise.resolve(opts.onError(buildContext(server), error)); } catch { /* protect loop */ }
        }
        console.error(`[cron:${opts.name}]`, error);
      })
      .finally(() => { running = false; });
  }

  const internals: CronInternals = {
    channelName: opts.channelName,
    pubsub: opts.pubsub,
    stores: opts.stores,
    start(_server, _adapter) {
      if (cronInstance) return;
      cronInstance = new Cron(
        opts.schedule.expression,
        opts.schedule.tz ? { timezone: opts.schedule.tz } : undefined,
        safeRun,
      );
    },
    stop() {
      cronInstance?.stop();
      cronInstance = null;
    },
  };

  const job: CronJob = {
    name: opts.name,
    [symbols.cron]: internals,
    last: null,
    stop() { internals.stop(); },
    isRunning() { return cronInstance !== null; },
    nextRun() { return cronInstance?.nextRun() ?? null; },
  };

  return job;
}
