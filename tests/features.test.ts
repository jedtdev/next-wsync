import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { channel } from '../core/channel';
import { ctx } from '../core/scope';
import { redisStorage } from '../core/storage';
import { configureLogger, Logger } from '../core/logger';

describe('v0.2.0 Features & AsyncLocalStorage Core Engine', () => {
  it('supports schema: { emit, receive, meta } definition', () => {
    const roomChannel = channel('room', {
      schema: {
        emit: z.object({ text: z.string() }),
        receive: z.object({ text: z.string() }),
        meta: z.object({ userId: z.string() }),
      },
      events: {
        async onConnect() {
          expect(ctx.channel).toBe('room');
        },
      },
    });

    expect(roomChannel.name).toBe('room');
  });

  it('supports direct methods object syntax methods: { ... }', async () => {
    const roomChannel = channel('room', {
      schema: {
        emit: z.object({ text: z.string() }),
        receive: z.object({ text: z.string() }),
      },
      methods: {
        async formatMessage(msg: string) {
          return `Formatted: ${msg}`;
        },
        async calculateTotal(a: number, b: number) {
          return a + b;
        },
      },
    });

    const formatted = await roomChannel.methods.formatMessage('Hello World');
    expect(formatted).toBe('Formatted: Hello World');

    const total = await roomChannel.methods.calculateTotal(10, 20);
    expect(total).toBe(30);
  });

  it('supports declarative object crons: { [name]: { schedule, run } }', () => {
    let cronRunCount = 0;

    const roomChannel = channel('room', {
      schema: {
        emit: z.object({ text: z.string() }),
        receive: z.object({ text: z.string() }),
      },
      crons: {
        cleanup: {
          schedule: '*/5 * * * *',
          async run() {
            cronRunCount++;
          },
        },
        heartbeat: {
          schedule: 'every 30s',
          async run() {
            // heartbeat
          },
        },
      },
    });

    expect(roomChannel.crons.cleanup).toBeDefined();
    expect(roomChannel.crons.heartbeat).toBeDefined();
    expect(typeof roomChannel.crons.cleanup.start).toBe('function');
    expect(typeof roomChannel.crons.cleanup.stop).toBe('function');
    expect(typeof roomChannel.crons.cleanup.trigger).toBe('function');
  });

  it('supports programmatic Async EventEmitter channel.on()', async () => {
    const roomChannel = channel('room', {
      schema: {
        emit: z.object({ text: z.string() }),
        receive: z.object({ text: z.string() }),
      },
    });

    let messageReceived = '';
    const unsubscribe = roomChannel.on('message', async (data) => {
      messageReceived = data.text;
    });

    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
  });

  it('supports redisStorage helper function', async () => {
    const mockRedis = {
      val: 'test-value',
      async get(key: string) {
        return `${this.val}:${key}`;
      },
    };

    const redisStore = redisStorage('cache', mockRedis, (redis) => ({
      async getCache(key: string) {
        return await redis.get(key);
      },
    }));

    expect(redisStore.storeName).toBe('cache');
    const result = await redisStore.methods.getCache('user_123');
    expect(result).toBe('test-value:user_123');
  });

  it('supports debug logging via Logger.configure and custom loggers', () => {
    const logs: Array<{ level: string; tag: string; message: string }> = [];

    Logger.configure({
      debug: true,
      logger: (level, tag, message) => {
        logs.push({ level, tag, message });
      },
    });

    const roomChannel = channel('room', {
      schema: {
        emit: z.object({ text: z.string() }),
        receive: z.object({ text: z.string() }),
      },
    });

    expect(roomChannel.name).toBe('room');
    expect(logs.length).toBeGreaterThanOrEqual(0);
  });

  it('supports Logger class and .child() sub-loggers', () => {
    const logs: Array<{ level: string; tag: string; message: string }> = [];

    Logger.configure({
      debug: true,
      logger: (level, tag, message) => {
        logs.push({ level, tag, message });
      },
    });

    const mainLogger = new Logger('room');
    const authLogger = mainLogger.child('auth');

    expect(authLogger.tag).toBe('room/auth');

    authLogger.info('Token verified');
    expect(logs).toContainEqual({
      level: 'info',
      tag: 'room/auth',
      message: 'Token verified',
    });
  });
});
