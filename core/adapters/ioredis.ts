import Redis, { type RedisOptions } from 'ioredis';
import { buildAdapter, type RedisLike } from './shared';
import type { PubSubAdapter } from './types';

const DEFAULTS: RedisOptions = {
  tls: {},
  maxRetriesPerRequest: null,
  enableOfflineQueue: true,
  connectTimeout: 10_000,
  lazyConnect: false,
};

// Accepts a connection string or any ioredis-compatible client.
// Works with standard Redis, Upstash (pass a rediss:// URL), and Valkey
// (pass an iovalkey instance — it's a drop-in for ioredis).
// Options are merged over defaults and only apply when passing a URL string.
export function redis(
  client: string | RedisLike,
  options?: RedisOptions,
): PubSubAdapter {
  const pub: RedisLike =
    typeof client === 'string'
      ? new Redis(client, { ...DEFAULTS, ...options })
      : client;
  return buildAdapter(pub, pub.duplicate());
}

export { redis as upstash, redis as valkey };
