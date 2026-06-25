import type { PubSubAdapter } from './types';

const PREFIX = 'ws:';

interface WireMessage {
  serverId: string;
  data: unknown;
}

export interface RedisLike {
  on(event: 'error', listener: (err: Error) => void): unknown;
  on(event: 'connect', listener: () => void): unknown;
  on(event: 'message', listener: (channel: string, raw: string) => void): unknown;
  removeAllListeners(event: string): unknown;
  publish(channel: string, message: string): Promise<unknown>;
  subscribe(channel: string): Promise<unknown>;
  unsubscribe(channel: string): Promise<unknown>;
  quit(): Promise<unknown>;
  duplicate(): RedisLike;
}

export function buildAdapter(pub: RedisLike, sub: RedisLike): PubSubAdapter {
  const serverId = crypto.randomUUID();
  const handlers = new Map<string, (data: unknown) => void>();

  let pubLastErr = '';
  let subLastErr = '';

  pub.on('error', (err) => {
    if (err.message === pubLastErr) return;
    pubLastErr = err.message;
    console.error('[ws:pub]', err.message);
  });
  sub.on('error', (err) => {
    if (err.message === subLastErr) return;
    subLastErr = err.message;
    console.error('[ws:sub]', err.message);
  });

  pub.on('connect', () => { pubLastErr = ''; });
  sub.on('connect', () => { subLastErr = ''; });

  sub.on('message', (ch, raw) => {
    if (!ch.startsWith(PREFIX)) return;
    let msg: WireMessage;
    try {
      msg = JSON.parse(raw) as WireMessage;
    } catch {
      return;
    }
    if (msg.serverId === serverId) return;
    handlers.get(ch.slice(PREFIX.length))?.(msg.data);
  });

  return {
    async publish(channel, data) {
      const msg: WireMessage = { serverId, data };
      await pub.publish(`${PREFIX}${channel}`, JSON.stringify(msg));
    },
    subscribe(channel, handler) {
      handlers.set(channel, handler);
      void sub.subscribe(`${PREFIX}${channel}`);
    },
    unsubscribe(channel) {
      handlers.delete(channel);
      void sub.unsubscribe(`${PREFIX}${channel}`);
    },
    async close() {
      handlers.clear();
      sub.removeAllListeners('message');
      await sub.quit();
    },
  };
}
