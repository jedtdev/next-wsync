import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextRequest } from 'next/server';
import type WebSocket from 'ws';
import type { WebSocketServer } from 'ws';
import type {
  ChannelBroadcast,
  ClientsAccessor,
  CronControl,
  MetaAccessor,
} from './types';
import type { ReadonlyHeaders, ReadonlyRequestsCookies } from './utils';
import type { ScopeLogger } from './logger';

export interface WsyncScope<
  TName extends string = string,
  TEmit = unknown,
  TStores = unknown,
  TMeta extends Record<string, unknown> = Record<string, unknown>,
  TCrons extends Record<string, CronControl> = Record<string, CronControl>,
> {
  readonly client: WebSocket;
  readonly request: NextRequest;
  readonly channel: TName;
  readonly server: WebSocketServer;
  readonly params: URLSearchParams;
  readonly stores: TStores;
  readonly meta: MetaAccessor<TMeta>;
  readonly broadcast: ChannelBroadcast<TEmit, TMeta>;
  readonly clients: ClientsAccessor<TEmit, TMeta>;
  readonly crons: TCrons;
  readonly cookies: ReadonlyRequestsCookies;
  readonly headers: ReadonlyHeaders;
  readonly log: ScopeLogger;
  readonly reply: (data: TEmit) => void;
  readonly disconnect: (code?: number, reason?: string) => void;
}

const kRequestStorage = Symbol.for('next-ws.request-store');

export const scopeStorage: AsyncLocalStorage<WsyncScope<any, any, any, any, any>> =
  (Reflect.get(globalThis, kRequestStorage) as AsyncLocalStorage<
    WsyncScope<any, any, any, any, any>
  >) ??
  (() => {
    const storage = new AsyncLocalStorage<WsyncScope<any, any, any, any, any>>();
    Reflect.set(globalThis, kRequestStorage, storage);
    return storage;
  })();

export const ctx = new Proxy({} as WsyncScope, {
  get(_target, prop: string | symbol) {
    const scope = scopeStorage.getStore();
    if (!scope) {
      throw new Error(
        `[next-wsync] Cannot access 'ctx.${String(prop)}' outside of a WebSocket event, method, or cron execution scope.`,
      );
    }
    return Reflect.get(scope, prop);
  },
});

export function useStore(): WsyncScope | undefined {
  return scopeStorage.getStore();
}
