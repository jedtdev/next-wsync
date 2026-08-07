import WebSocket from 'ws';
import { RequestCookies } from 'next/dist/compiled/@edge-runtime/cookies';
import type { BroadcastOptions, QuerySelector, ServerMessage } from './types';

export class ReadonlyHeaders extends Headers {
  override append(): void {
    throw new Error('Headers are read-only in WebSocket context');
  }
  override set(): void {
    throw new Error('Headers are read-only in WebSocket context');
  }
  override delete(): void {
    throw new Error('Headers are read-only in WebSocket context');
  }
}

export class ReadonlyRequestsCookies extends RequestCookies {
  override set(): this {
    throw new Error('Cookies are read-only in WebSocket context');
  }
  override delete(_names: string | string[]): boolean | boolean[] {
    throw new Error('Cookies are read-only in WebSocket context');
  }
}

export function matchesSelector(
  selector: QuerySelector,
  client: WebSocket,
): boolean {
  for (const [key, op] of Object.entries(selector)) {
    const val =
      key === 'id' ? client.id :
      key === 'iat' ? client.iat :
      client.meta[key];

    if (op !== null && typeof op === 'object') {
      if ('$eq' in op) { if (val !== op.$eq) return false; continue; }
      if ('$ne' in op) { if (val === op.$ne) return false; continue; }
      if ('$in' in op) { if (!(op.$in as unknown[]).includes(val)) return false; continue; }
      if ('$nin' in op) { if ((op.$nin as unknown[]).includes(val)) return false; continue; }
      if ('$gt' in op) { if (typeof val !== 'number' || val <= (op.$gt as number)) return false; continue; }
      if ('$gte' in op) { if (typeof val !== 'number' || val < (op.$gte as number)) return false; continue; }
      if ('$lt' in op) { if (typeof val !== 'number' || val >= (op.$lt as number)) return false; continue; }
      if ('$lte' in op) { if (typeof val !== 'number' || val > (op.$lte as number)) return false; continue; }
      if ('$exists' in op) { if ((val !== undefined) !== op.$exists) return false; continue; }
    }

    if (val !== op) return false;
  }
  return true;
}

export function isExcluded(
  opts: BroadcastOptions | undefined,
  client: WebSocket,
): boolean {
  if (!opts?.except) return false;
  return matchesSelector(opts.except, client);
}

export function sendEvent<T>(client: WebSocket, data: T): void {
  if (client.readyState !== WebSocket.OPEN) return;
  const msg: ServerMessage<T> = { type: 'message', data };
  client.send(JSON.stringify(msg));
}
