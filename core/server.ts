import type { NextRequest } from 'next/server';
import type WebSocket from 'ws';
import type { WebSocketServer } from 'ws';
import type { PubSubAdapter } from './adapters';
import type { Channel } from './channel';
import type { CronJob } from './cron';
import { symbols } from './constants';
import type { QuerySelector, RealtimeApi } from './types';
import { matchesSelector } from './utils';

import { configureLogger, type DebugOption, type LogLevel, logMessage } from './logger';

// ── Stats ─────────────────────────────────────────────────────

export interface Stats {
  total(): number;
  channel(): Record<string, number>;
  channel(name: string): number;
  ids(): string[];
  get(clientId: string): WebSocket | undefined;
  filter(predicate: (client: WebSocket) => boolean): Array<WebSocket>;
  query(selector: QuerySelector, channelName?: string): Array<WebSocket>;
  snapshot(
    channelName?: string,
  ): Array<{ id: string; meta: Record<string, unknown> }>;
}

// ── Config ────────────────────────────────────────────────────

export interface RealtimeOptions {
  jobs?: readonly CronJob[];
  adapter?: PubSubAdapter;
  debug?: DebugOption;
  logger?: (level: LogLevel, tag: string, message: string, meta?: unknown) => void;
}

// ── RealtimeServer ────────────────────────────────────────────

class RealtimeServer {
  private clients = new Map<string, WebSocket>();
  private channels = new Map<string, Set<WebSocket>>();
  private drainTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private channelMap: Map<string, Channel>;
  private adapter?: PubSubAdapter;
  private globalJobs: readonly CronJob[];
  private jobs = new Set<CronJob>();
  private isJobStarted = false;
  private isProcessAttached = false;

  constructor(channels: ReadonlyArray<Channel>, options: RealtimeOptions = {}) {
    configureLogger({ debug: options.debug, logger: options.logger });
    this.adapter = options.adapter;
    this.globalJobs = options.jobs ?? [];

    this.channelMap = new Map();
    for (const ch of channels) {
      if (this.channelMap.has(ch.name)) {
        throw new Error(`Duplicate channel name: "${ch.name}"`);
      }
      this.channelMap.set(ch.name, ch);
    }
  }

  // ── Client registry ───────────────────────────────────────

  private add(client: WebSocket, channelName: string): void {
    this.clients.set(client.id, client);

    const pending = this.drainTimers.get(channelName);
    if (pending !== undefined) {
      clearTimeout(pending);
      this.drainTimers.delete(channelName);
    }

    let group = this.channels.get(channelName);
    if (!group) {
      group = new Set();
      this.channels.set(channelName, group);
      this.subscribeChannel(channelName);
    }
    group.add(client);
  }

  private remove(client: WebSocket, channelName: string): void {
    this.clients.delete(client.id);
    const group = this.channels.get(channelName);
    if (!group) return;
    group.delete(client);

    if (group.size === 0) {
      const timer = setTimeout(() => {
        this.drainTimers.delete(channelName);
        this.channels.delete(channelName);
        this.unsubscribeChannel(channelName);
      }, 10_000);
      this.drainTimers.set(channelName, timer);
    }
  }

  private subscribeChannel(channelName: string): void {
    const handler = this.channelMap.get(channelName);
    if (!handler?.[symbols.channel].pubsub || !this.adapter) return;
    this.adapter.subscribe(channelName, (msg) => {
      const group = this.channels.get(channelName);
      if (group) handler[symbols.channel].handlePubSub(group, msg);
    });
  }

  private unsubscribeChannel(channelName: string): void {
    this.adapter?.unsubscribe(channelName);
  }

  // ── Stats ─────────────────────────────────────────────────

  readonly stats: Stats = {
    total: () => this.clients.size,

    channel: ((name?: string): number | Record<string, number> => {
      if (name !== undefined) return this.channels.get(name)?.size ?? 0;
      const counts: Record<string, number> = {};
      for (const [ch, set] of this.channels) counts[ch] = set.size;
      return counts;
    }) as unknown as Stats['channel'],

    ids: () => [...this.clients.keys()],

    get: (clientId) => this.clients.get(clientId),

    filter: (predicate) => {
      const result: Array<WebSocket> = [];
      for (const client of this.clients.values()) {
        if (predicate(client)) result.push(client);
      }
      return result;
    },

    query: (selector, channelName) => {
      const pool = channelName
        ? (this.channels.get(channelName) ?? new Set<WebSocket>())
        : this.clients.values();
      const result: Array<WebSocket> = [];
      for (const client of pool) {
        if (matchesSelector(selector, client)) result.push(client);
      }
      return result;
    },

    snapshot: (channelName) => {
      const pool = channelName
        ? (this.channels.get(channelName) ?? new Set<WebSocket>())
        : this.clients.values();
      const result: Array<{ id: string; meta: Record<string, unknown> }> = [];
      for (const client of pool) {
        result.push({ id: client.id, meta: { ...client.meta } });
      }
      return result;
    },
  };

  // ── Lifecycle ─────────────────────────────────────────────

  // Jobs are collected lazily at first connection so channel().cron() calls
  // made after wsync() construction are still picked up.
  private startJobs(server: WebSocketServer): void {
    if (this.isJobStarted) return;
    this.isJobStarted = true;
    this.attachShutdown();

    const jobNames = new Set<string>();
    const allJobs: CronJob[] = [
      ...Array.from(this.channelMap.values()).flatMap((ch) => [...ch[symbols.channel].jobs]),
      ...this.globalJobs,
    ];

    for (const j of allJobs) {
      if (jobNames.has(j.name)) throw new Error(`Duplicate job name: "${j.name}"`);
      jobNames.add(j.name);
      this.jobs.add(j);
      j[symbols.cron].start(server, this.adapter);
    }
  }

  private attachShutdown(): void {
    if (this.isProcessAttached) return;
    this.isProcessAttached = true;
    const cleanup = () => {
      for (const timer of this.drainTimers.values()) clearTimeout(timer);
      this.drainTimers.clear();
      for (const j of this.jobs) j[symbols.cron].stop();
      if (this.adapter) void this.adapter.close();
      for (const client of this.clients.values()) {
        if (client.readyState === client.OPEN)
          client.close(1001, 'Server shutting down');
      }
      this.clients.clear();
      this.channels.clear();
    };
    process.once('SIGTERM', cleanup);
    process.once('SIGINT', cleanup);
    process.once('beforeExit', cleanup);
  }

  // ── UPGRADE handler ───────────────────────────────────────

  handle(
    client: WebSocket,
    server: WebSocketServer,
    request: NextRequest,
  ): void {
    client.id = crypto.randomUUID();
    client.iat = Date.now();
    client.meta = {};
    client.disconnect = (opts) => client.close(opts?.code ?? 1000, opts?.reason ?? '');

    const url = new URL(request.url);
    const channelName = url.pathname.split('/').at(-1) ?? '';
    const handler = this.channelMap.get(channelName);

    logMessage('debug', 'upgrade', `HTTP Upgrade request for channel "${channelName}" (client: ${client.id})`);

    if (!handler) {
      logMessage('warn', 'upgrade', `Rejected upgrade for unknown channel "${channelName}" (client: ${client.id})`);
      client.close(1008, 'Unknown channel');
      return;
    }

    client.meta['channel'] = channelName;
    this.add(client, channelName);
    this.startJobs(server);

    const raw = {
      client,
      server,
      channel: channelName,
      params: url.searchParams,
      request,
      adapter: this.adapter,
    };

    void handler[symbols.channel].onConnect(raw);

    client.on('message', (data) => {
      const parsed: unknown = (() => {
        try { return JSON.parse(data.toString()) as unknown; }
        catch { return data.toString(); }
      })();
      void handler[symbols.channel].onMessage(raw, parsed);
    });

    client.on('close', () => {
      this.remove(client, channelName);
      void handler[symbols.channel].onDisconnect(raw);
    });

    client.on('error', (err) => void handler[symbols.channel].onError(raw, err));
  }
}

// ── Public factory ────────────────────────────────────────────

export function wsync<const TChannels extends ReadonlyArray<Channel>>(
  channels: TChannels,
  options?: RealtimeOptions,
): RealtimeApi<TChannels> {
  const ws = new RealtimeServer(channels, options);
  const UPGRADE = (
    client: WebSocket,
    server: WebSocketServer,
    request: NextRequest,
  ): void => {
    ws.handle(client, server, request);
  };
  UPGRADE.stats = ws.stats;
  UPGRADE.channels = new Set(channels.map((ch) => ch.name)) as ReadonlySet<string>;
  return UPGRADE as RealtimeApi<TChannels>;
}
