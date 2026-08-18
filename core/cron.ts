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

export type Schedule =
  | string
  | {
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
  running: boolean;
  start(server: WebSocketServer, adapter?: PubSubAdapter): void;
  stop(): void;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface CronJob<TName extends string = string, TEmit = unknown> {
  readonly name: TName;
  readonly [symbols.cron]: CronInternals;
  stop(): void;
  isRunning(): boolean;
  getNextRun(): Date | null;
  getLastRun(): CronJobLast | null;
}

// JobContext — used by standalone cron(), not channel crons
export interface JobContext<TEmit = unknown, TStores = unknown> {
  server: WebSocketServer;
  channel: string | null;
  stores: TStores;
  broadcast: {
    all(data: TEmit, opts?: BroadcastOptions): Promise<void>;
    to(selector: QuerySelector, data: TEmit, opts?: BroadcastOptions): Promise<void>;
    except(selector: QuerySelector, data: TEmit): Promise<void>;
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
    get running() {
      return cronInstance?.isRunning() ?? false;
    },

    start(server, adapter) {
      if (cronInstance) return;
      serverRef = server;
      adapterRef = adapter;
      const expr = typeof def.schedule === 'string' ? def.schedule : def.schedule.expression;
      const tz = typeof def.schedule === 'string' ? undefined : def.schedule.tz;

      cronInstance = new Cron(
        expr,
        tz ? { timezone: tz } : undefined,
        safeRun,
      );
    },

    stop() {
      cronInstance?.stop();
      cronInstance = null;
    },
  };

  let lastRun: CronJobLast | null = null;

  function buildJobCtx(server: WebSocketServer): JobContext<TEmit, TStores> {
    return {
      server,
      channel: null,
      stores: internals.stores as TStores,
      broadcast: {
        async all(data, opts) {
          server.clients.forEach((c) => {
            if (c.readyState === WebSocket.OPEN && !isExcluded(opts, c)) sendEvent(c, data);
          });
        },
        async to(selector, data, opts) {
          server.clients.forEach((c) => {
            if (c.readyState === WebSocket.OPEN && matchesSelector(selector, c) && !isExcluded(opts, c)) {
              sendEvent(c, data);
            }
          });
        },
        async except(selector, data) {
          server.clients.forEach((c) => {
            if (c.readyState === WebSocket.OPEN && !matchesSelector(selector, c)) {
              sendEvent(c, data);
            }
          });
        },
      },
      stop() {
        internals.stop();
      },
    };
  }

  async function safeRun(): Promise<void> {
    if (!serverRef) return;
    const started = new Date();
    try {
      await def.run(buildJobCtx(serverRef));
      const finished = new Date();
      lastRun = {
        arguments: null,
        error: null,
        timestamps: { started, finished, durationMs: finished.getTime() - started.getTime() },
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const finished = new Date();
      lastRun = {
        arguments: null,
        error,
        timestamps: { started, finished, durationMs: finished.getTime() - started.getTime() },
      };
      if (def.onError && serverRef) {
        try {
          await def.onError(buildJobCtx(serverRef), error);
        } catch {
          // Suppress error in onError
        }
      }
    }
  }

  return {
    name,
    [symbols.cron]: internals,
    stop() {
      internals.stop();
    },
    isRunning() {
      return cronInstance?.isRunning() ?? false;
    },
    getNextRun() {
      return cronInstance?.nextRun() ?? null;
    },
    getLastRun() {
      return lastRun;
    },
  };
}

// ── Internal helper for channel crons ─────────────────────────

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
}): CronJob<string, TEmit> {
  let cronInstance: Cron | null = null;
  let running = false;
  let lastRun: CronJobLast | null = null;

  function buildClientsAccessor(server: WebSocketServer): ClientsAccessor<TEmit, TMeta> {
    const pool = () => opts.getChannelClients(server);
    return {
      get size() {
        return pool().size;
      },
      find(selector) {
        const result: WebSocket[] = [];
        for (const c of pool()) {
          if (matchesSelector(selector as QuerySelector, c)) result.push(c);
        }
        return result;
      },
      send(selector, data) {
        const matched: WebSocket[] = [];
        for (const c of pool()) {
          if (matchesSelector(selector as QuerySelector, c)) {
            sendEvent(c, data);
            matched.push(c);
          }
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
      async all(data, broadcastOpts) {
        for (const c of pool()) {
          if (c.readyState === WebSocket.OPEN && !isExcluded(broadcastOpts, c)) sendEvent(c, data);
        }
        const adp = opts.adapterRef();
        if (opts.pubsub && adp) await adp.publish(ch, { type: 'all', data, opts: broadcastOpts });
      },
      async to(selector, data, broadcastOpts) {
        for (const c of pool()) {
          if (c.readyState === WebSocket.OPEN && matchesSelector(selector as QuerySelector, c) && !isExcluded(broadcastOpts, c))
            sendEvent(c, data);
        }
        const adp = opts.adapterRef();
        if (opts.pubsub && adp) await adp.publish(ch, { type: 'to', selector: selector as QuerySelector, data, opts: broadcastOpts });
      },
      async except(selector, data) {
        for (const c of pool()) {
          if (c.readyState === WebSocket.OPEN && !matchesSelector(selector as QuerySelector, c)) sendEvent(c, data);
        }
        const adp = opts.adapterRef();
        if (opts.pubsub && adp) await adp.publish(ch, { type: 'except', selector: selector as QuerySelector, data });
      },
      channel(targetName) {
        return {
          async all(data, broadcastOpts) {
            const srv = opts.serverRef();
            if (!srv) return;
            for (const c of srv.clients as Set<WebSocket>) {
              if (c.meta?.['channel'] === targetName && c.readyState === WebSocket.OPEN && !isExcluded(broadcastOpts, c))
                sendEvent(c, data);
            }
            const adp = opts.adapterRef();
            if (adp) await adp.publish(targetName, { type: 'all', data, opts: broadcastOpts });
          },
          async to(selector, data, broadcastOpts) {
            const srv = opts.serverRef();
            if (!srv) return;
            for (const c of srv.clients as Set<WebSocket>) {
              if (c.meta?.['channel'] === targetName && matchesSelector(selector, c) && !isExcluded(broadcastOpts, c))
                sendEvent(c, data);
            }
            const adp = opts.adapterRef();
            if (adp) await adp.publish(targetName, { type: 'to', selector, data, opts: broadcastOpts });
          },
          async except(selector, data) {
            const srv = opts.serverRef();
            if (!srv) return;
            for (const c of srv.clients as Set<WebSocket>) {
              if (c.meta?.['channel'] === targetName && !matchesSelector(selector, c))
                sendEvent(c, data);
            }
            const adp = opts.adapterRef();
            if (adp) await adp.publish(targetName, { type: 'except', selector, data });
          },
        };
      },
    };
  }

  function buildCtx(server: WebSocketServer): CronContext<TName, TEmit, TStores, TMeta> {
    return {
      channel: opts.channelName,
      stores: opts.stores,
      clients: buildClientsAccessor(server),
      broadcast: buildBroadcast(server),
      stop() {
        internals.stop();
      },
    };
  }

  const internals: CronInternals = {
    channelName: opts.channelName,
    pubsub: opts.pubsub,
    stores: opts.stores,
    get running() {
      return running;
    },

    start(server) {
      if (cronInstance) return;
      const expr = typeof opts.schedule === 'string' ? opts.schedule : opts.schedule.expression;
      const tz = typeof opts.schedule === 'string' ? undefined : opts.schedule.tz;

      cronInstance = new Cron(
        expr,
        tz ? { timezone: tz } : undefined,
        async () => {
          running = true;
          const started = new Date();
          try {
            await opts.run(buildCtx(server));
            const finished = new Date();
            lastRun = {
              arguments: null,
              error: null,
              timestamps: { started, finished, durationMs: finished.getTime() - started.getTime() },
            };
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            const finished = new Date();
            lastRun = {
              arguments: null,
              error,
              timestamps: { started, finished, durationMs: finished.getTime() - started.getTime() },
            };
            if (opts.onError) {
              try {
                await opts.onError(buildCtx(server), error);
              } catch {
                // Suppress error in onError
              }
            }
          } finally {
            running = false;
          }
        },
      );
    },

    stop() {
      cronInstance?.stop();
      cronInstance = null;
    },
  };

  return {
    name: opts.name,
    [symbols.cron]: internals,
    stop() {
      internals.stop();
    },
    isRunning() {
      return running;
    },
    getNextRun() {
      return cronInstance?.nextRun() ?? null;
    },
    getLastRun() {
      return lastRun;
    },
  };
}
