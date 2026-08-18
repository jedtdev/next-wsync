import type { NextRequest } from 'next/server';
import type WebSocket from 'ws';
import type { WebSocketServer } from 'ws';
import type { PubSubAdapter } from './adapters';
import type { symbols } from './constants';
import type { Channel } from './channel';
import type { Stats } from './server';
import type { MethodMap } from './storage';
import type { ReadonlyHeaders, ReadonlyRequestsCookies } from './utils';

// ── Disconnect ─────────────────────────────────────────────────

export interface DisconnectOptions {
  code?: number;
  reason?: string;
}

// Augments ws.WebSocket with fields set by WsyncServer.handle().
declare module 'ws' {
  interface WebSocket {
    id: string;
    iat: number;
    meta: Record<string, unknown>;
    disconnect(opts?: DisconnectOptions): void;
  }
}

// ── Cron Control ──────────────────────────────────────────────

export interface CronControl {
  start(): void;
  stop(): void;
  trigger(): Promise<void>;
  readonly running: boolean;
}

// ── Selector ──────────────────────────────────────────────────

export type QueryOp<T> =
  | T
  | { $eq: T }
  | { $ne: T }
  | { $in: T[] }
  | { $nin: T[] }
  | (T extends number ? { $gt: T } | { $gte: T } | { $lt: T } | { $lte: T } : never)
  | { $exists: boolean };

type WsBuiltins = { id: string; iat: number };

export type QuerySelector<
  TMeta extends Record<string, unknown> = Record<string, unknown>,
> = {
  [K in keyof (WsBuiltins & TMeta)]?: QueryOp<(WsBuiltins & TMeta)[K]>;
};

// ── Broadcast ─────────────────────────────────────────────────

export interface BroadcastOptions<
  TMeta extends Record<string, unknown> = Record<string, unknown>,
> {
  except?: QuerySelector<TMeta>;
}

export interface CrossChannelBroadcast<
  TEmit = unknown,
  TMeta extends Record<string, unknown> = Record<string, unknown>,
> {
  all(data: TEmit, opts?: BroadcastOptions<TMeta>): Promise<void>;
  to(selector: QuerySelector<TMeta>, data: TEmit, opts?: BroadcastOptions<TMeta>): Promise<void>;
  except(selector: QuerySelector<TMeta>, data: TEmit): Promise<void>;
}

export interface ChannelBroadcast<
  TEmit = unknown,
  TMeta extends Record<string, unknown> = Record<string, unknown>,
> {
  all(data: TEmit, opts?: BroadcastOptions<TMeta>): Promise<void>;
  others(data: TEmit, opts?: BroadcastOptions<TMeta>): Promise<void>;
  to(selector: QuerySelector<TMeta>, data: TEmit, opts?: BroadcastOptions<TMeta>): Promise<void>;
  except(selector: QuerySelector<TMeta>, data: TEmit): Promise<void>;
  channel<TTargetEmit = unknown, TTargetMeta extends Record<string, unknown> = Record<string, unknown>>(
    name: string,
  ): CrossChannelBroadcast<TTargetEmit, TTargetMeta>;
}

export interface CronBroadcast<
  TEmit = unknown,
  TMeta extends Record<string, unknown> = Record<string, unknown>,
> {
  all(data: TEmit, opts?: BroadcastOptions<TMeta>): Promise<void>;
  to(selector: QuerySelector<TMeta>, data: TEmit, opts?: BroadcastOptions<TMeta>): Promise<void>;
  except(selector: QuerySelector<TMeta>, data: TEmit): Promise<void>;
  channel<TTargetEmit = unknown, TTargetMeta extends Record<string, unknown> = Record<string, unknown>>(
    name: string,
  ): CrossChannelBroadcast<TTargetEmit, TTargetMeta>;
}

// ── Client selection ──────────────────────────────────────────

export interface ClientsAccessor<
  TEmit = unknown,
  TMeta extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly size: number;
  find(selector: QuerySelector<TMeta>): WebSocket[];
  send(selector: QuerySelector<TMeta>, data: TEmit): WebSocket[];
  update(
    selector: QuerySelector<TMeta>,
    patch: Partial<TMeta> | ((prev: TMeta) => TMeta),
  ): WebSocket[];
  disconnect(selector: QuerySelector<TMeta>, opts?: DisconnectOptions): WebSocket[];
}

// ── Contexts ──────────────────────────────────────────────────

export interface RawContext<TName extends string> {
  client: WebSocket;
  server: WebSocketServer;
  channel: TName;
  params: URLSearchParams;
  request: NextRequest;
  adapter?: PubSubAdapter;
}

export interface MetaAccessor<TMeta extends Record<string, unknown>> {
  set<K extends keyof TMeta & string>(key: K, value: TMeta[K]): void;
  set(updater: (prev: TMeta) => TMeta): void;
  get<K extends keyof TMeta & string>(key: K, defaultValue: TMeta[K]): TMeta[K];
  get<K extends keyof TMeta & string>(key: K): TMeta[K] | undefined;
  readonly original: TMeta;
}

export interface ChannelMethodCtx<
  TEmit = unknown,
  TStores = unknown,
  TMeta extends Record<string, unknown> = Record<string, unknown>,
> {
  stores: TStores;
  broadcast: ChannelBroadcast<TEmit, TMeta>;
}

import type { ScopeLogger } from './logger';

export interface ChannelContext<
  TName extends string = string,
  TEmit = unknown,
  TStores = unknown,
  TMeta extends Record<string, unknown> = Record<string, unknown>,
  TCrons extends Record<string, CronControl> = Record<string, CronControl>,
> {
  client: WebSocket;
  server: WebSocketServer;
  channel: TName;
  params: URLSearchParams;
  request: NextRequest;
  stores: TStores;
  meta: MetaAccessor<TMeta>;
  clients: ClientsAccessor<TEmit, TMeta>;
  crons: TCrons;
  cookies: ReadonlyRequestsCookies;
  headers: ReadonlyHeaders;
  log: ScopeLogger;
  reply(data: TEmit): void;
  broadcast: ChannelBroadcast<TEmit, TMeta>;
  disconnect(code?: number, reason?: string): void;
}

export interface CronContext<
  TName extends string = string,
  TEmit = unknown,
  TStores = unknown,
  TMeta extends Record<string, unknown> = Record<string, unknown>,
> {
  channel: TName;
  stores: TStores;
  clients: ClientsAccessor<TEmit, TMeta>;
  broadcast: CronBroadcast<TEmit, TMeta>;
  stop(): void;
}

// ── PubSub ────────────────────────────────────────────────────

export interface PubSubMessage<TEmit = unknown> {
  type: 'all' | 'others' | 'to' | 'except';
  sender?: string;
  selector?: QuerySelector;
  data: TEmit;
  opts?: BroadcastOptions;
}

// ── Wire protocol ─────────────────────────────────────────────

export type ServerMessage<T = unknown> =
  | { type: 'connected'; id: string }
  | { type: 'message'; data: T }
  | { type: 'error'; reason: string; issues?: unknown };

export type ClientMessage<T = unknown> = { type: 'message'; data: T };

// ── Router inference ──────────────────────────────────────────

export type InferRouter<
  T extends readonly Channel<string, unknown, unknown>[],
> = {
  [K in T[number] as K['name']]: {
    emit: K[typeof symbols.emit];
    receive: K[typeof symbols.receive];
  };
};

export type RouterEmit<
  TRouter,
  TChannel extends keyof TRouter,
> = TRouter[TChannel] extends { emit: infer E } ? E : never;

export type RouterReceive<
  TRouter,
  TChannel extends keyof TRouter,
> = TRouter[TChannel] extends { receive: infer R } ? R : never;

export type WsyncApi<T extends readonly Channel[]> = ((
  client: WebSocket,
  server: WebSocketServer,
  request: NextRequest,
) => void) & {
  [symbols.router]: InferRouter<T>;
  stats: Stats;
  channels: ReadonlySet<string>;
};

export type Infer<T extends WsyncApi<readonly Channel[]>> =
  T[typeof symbols.router];

export type WsyncChannel<
  TChannel extends Channel,
  TMethodDefs extends MethodMap = Record<never, never>,
  TCrons extends Record<string, CronControl> = Record<string, CronControl>,
> = TChannel & {
  methods: TMethodDefs;
  crons: TCrons;
};
