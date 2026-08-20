import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { defineAdapter } from '../core/adapters/define';
import { buildAdapter, type RedisLike } from '../core/adapters/shared';

// In-memory stand-in for ioredis — buildAdapter only needs the RedisLike
// surface, so a real Redis server isn't required to exercise its logic.
class FakeBroker {
  channels = new Map<string, Set<FakeRedisClient>>();
}

class FakeRedisClient extends EventEmitter implements RedisLike {
  constructor(private broker: FakeBroker) {
    super();
  }

  async publish(channel: string, message: string) {
    for (const sub of this.broker.channels.get(channel) ?? []) sub.emit('message', channel, message);
    return 1;
  }

  async subscribe(channel: string) {
    const subs = this.broker.channels.get(channel) ?? new Set();
    subs.add(this);
    this.broker.channels.set(channel, subs);
  }

  async unsubscribe(channel: string) {
    this.broker.channels.get(channel)?.delete(this);
  }

  async quit() {}

  duplicate(): RedisLike {
    return new FakeRedisClient(this.broker);
  }
}

function makeAdapter(broker: FakeBroker) {
  return buildAdapter(new FakeRedisClient(broker), new FakeRedisClient(broker));
}

describe('buildAdapter (pub/sub)', () => {
  it('delivers published data to a subscribed handler', async () => {
    const broker = new FakeBroker();
    const sender = makeAdapter(broker);
    const receiver = makeAdapter(broker);

    const received: unknown[] = [];
    receiver.subscribe('room', (data) => received.push(data));

    await sender.publish('room', { text: 'hi' });

    expect(received).toEqual([{ text: 'hi' }]);
  });

  it('suppresses messages published by the same adapter instance', async () => {
    const broker = new FakeBroker();
    const adapter = makeAdapter(broker);

    const received: unknown[] = [];
    adapter.subscribe('room', (data) => received.push(data));

    await adapter.publish('room', { text: 'echo' });

    expect(received).toEqual([]);
  });

  it('stops delivering after unsubscribe', async () => {
    const broker = new FakeBroker();
    const sender = makeAdapter(broker);
    const receiver = makeAdapter(broker);

    const received: unknown[] = [];
    receiver.subscribe('room', (data) => received.push(data));
    receiver.unsubscribe('room');

    await sender.publish('room', { text: 'missed' });

    expect(received).toEqual([]);
  });

  it('stops delivering after close', async () => {
    const broker = new FakeBroker();
    const sender = makeAdapter(broker);
    const receiver = makeAdapter(broker);

    const received: unknown[] = [];
    receiver.subscribe('room', (data) => received.push(data));
    await receiver.close();

    await sender.publish('room', { text: 'after close' });

    expect(received).toEqual([]);
  });

  it('ignores malformed payloads instead of throwing', () => {
    const broker = new FakeBroker();
    const sub = new FakeRedisClient(broker);
    buildAdapter(new FakeRedisClient(broker), sub);

    expect(() => sub.emit('message', 'ws:room', 'not json')).not.toThrow();
  });
});

describe('defineAdapter', () => {
  it('lazily connects once, sharing the connection across calls', async () => {
    let connectCalls = 0;
    const conn = { connected: true };

    const adapter = defineAdapter({
      connect: () => {
        connectCalls++;
        return conn;
      },
      publish: () => {},
      subscribe: () => {},
      unsubscribe: () => {},
      close: () => {},
    });

    await adapter.publish('room', { text: 'hi' });
    adapter.subscribe('room', () => {});
    await Promise.resolve(); // subscribe() connects asynchronously

    expect(connectCalls).toBe(1);
  });

  it('forwards publish/subscribe/unsubscribe/close to the def with the connection', async () => {
    const conn = { id: 'conn-1' };
    const calls: unknown[] = [];

    const adapter = defineAdapter({
      connect: () => conn,
      publish: (c, channel, data) => void calls.push(['publish', c, channel, data]),
      subscribe: (c, channel) => void calls.push(['subscribe', c, channel]),
      unsubscribe: (c, channel) => void calls.push(['unsubscribe', c, channel]),
      close: (c) => void calls.push(['close', c]),
    });

    await adapter.publish('room', { text: 'hi' });
    adapter.subscribe('room', () => {});
    await Promise.resolve();
    adapter.unsubscribe('room');
    await Promise.resolve();
    await adapter.close();

    expect(calls).toEqual([
      ['publish', conn, 'room', { text: 'hi' }],
      ['subscribe', conn, 'room'],
      ['unsubscribe', conn, 'room'],
      ['close', conn],
    ]);
  });

  it('reconnects after close', async () => {
    let connectCalls = 0;
    const adapter = defineAdapter({
      connect: () => {
        connectCalls++;
        return { n: connectCalls };
      },
      publish: () => {},
      subscribe: () => {},
      unsubscribe: () => {},
      close: () => {},
    });

    await adapter.publish('room', {});
    await adapter.close();
    await adapter.publish('room', {});

    expect(connectCalls).toBe(2);
  });
});
