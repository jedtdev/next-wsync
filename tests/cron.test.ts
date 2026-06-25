import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocketServer } from 'ws';
import { cron } from '../core/cron';
import { symbols } from '../core/constants';

// Minimal mock WebSocketServer — cron only uses it for broadcast,
// which we're not testing here, so an empty clients Map suffices.
function mockServer(): WebSocketServer {
  return {
    clients: new Map(),
  } as unknown as WebSocketServer;
}

describe('cron()', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('job has the correct name', () => {
    const job = cron('my-job', {
      schedule: { expression: '*/5 * * * *' },
      run: () => {},
    });
    expect(job.name).toBe('my-job');
  });

  it('isRunning() returns false before start', () => {
    const job = cron('idle-job', {
      schedule: { expression: '*/1 * * * *' },
      run: () => {},
    });
    expect(job.isRunning()).toBe(false);
  });

  it('isRunning() returns true after internals.start()', () => {
    const job = cron('running-job', {
      schedule: { expression: '*/1 * * * *' },
      run: () => {},
    });

    job[symbols.cron].start(mockServer());
    expect(job.isRunning()).toBe(true);

    job.stop();
  });

  it('stop() makes isRunning() return false', () => {
    const job = cron('stoppable', {
      schedule: { expression: '*/1 * * * *' },
      run: () => {},
    });

    job[symbols.cron].start(mockServer());
    expect(job.isRunning()).toBe(true);

    job.stop();
    expect(job.isRunning()).toBe(false);
  });

  it('last is null before any run', () => {
    const job = cron('no-run-yet', {
      schedule: { expression: '*/5 * * * *' },
      run: () => {},
    });
    expect(job.last).toBeNull();
  });

  it('job runs on schedule and last is populated', async () => {
    // Use a cron expression that fires every second
    const runFn = vi.fn();
    const job = cron('every-second', {
      schedule: { expression: '* * * * * *' }, // every second (croner supports 6-field)
      run: runFn,
    });

    job[symbols.cron].start(mockServer());

    // Wait up to 1.5s for at least one tick
    await new Promise<void>((resolve) => {
      const start = Date.now();
      const interval = setInterval(() => {
        if (runFn.mock.calls.length > 0 || Date.now() - start > 1500) {
          clearInterval(interval);
          resolve();
        }
      }, 50);
    });

    job.stop();
    expect(runFn).toHaveBeenCalled();
  });

  it('job.last is populated with timestamps after a run', async () => {
    const job = cron('last-check', {
      schedule: { expression: '* * * * * *' },
      run: () => {},
    });

    job[symbols.cron].start(mockServer());

    // Wait for at least one run to complete
    await new Promise<void>((resolve) => {
      const start = Date.now();
      const interval = setInterval(() => {
        if (job.last !== null || Date.now() - start > 1500) {
          clearInterval(interval);
          resolve();
        }
      }, 50);
    });

    job.stop();
    expect(job.last).not.toBeNull();
    expect(job.last?.error).toBeNull();
    expect(job.last?.timestamps.started).toBeInstanceOf(Date);
    expect(job.last?.timestamps.finished).toBeInstanceOf(Date);
    expect(typeof job.last?.timestamps.durationMs).toBe('number');
  });

  it('onError is called when run throws', async () => {
    const onError = vi.fn();
    const job = cron('error-job', {
      schedule: { expression: '* * * * * *' },
      run: () => {
        throw new Error('intentional error');
      },
      onError,
    });

    job[symbols.cron].start(mockServer());

    // Wait for the error callback
    await new Promise<void>((resolve) => {
      const start = Date.now();
      const interval = setInterval(() => {
        if (onError.mock.calls.length > 0 || Date.now() - start > 1500) {
          clearInterval(interval);
          resolve();
        }
      }, 50);
    });

    job.stop();
    expect(onError).toHaveBeenCalled();
    const [, err] = onError.mock.calls[0] as [unknown, Error];
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('intentional error');
  });

  it('job.last.error is set when run throws', async () => {
    const job = cron('error-last', {
      schedule: { expression: '* * * * * *' },
      run: () => {
        throw new Error('boom');
      },
    });

    job[symbols.cron].start(mockServer());

    await new Promise<void>((resolve) => {
      const start = Date.now();
      const interval = setInterval(() => {
        if (job.last !== null || Date.now() - start > 1500) {
          clearInterval(interval);
          resolve();
        }
      }, 50);
    });

    job.stop();
    expect(job.last?.error).toBeInstanceOf(Error);
    expect(job.last?.error?.message).toBe('boom');
  });

  it('calling internals.start() twice does not create a second cron instance', () => {
    const runFn = vi.fn();
    const job = cron('idempotent', {
      schedule: { expression: '* * * * * *' },
      run: runFn,
    });

    const server = mockServer();
    job[symbols.cron].start(server);
    job[symbols.cron].start(server); // should be a no-op

    expect(job.isRunning()).toBe(true);
    job.stop();
    expect(job.isRunning()).toBe(false);
  });

  it('stop() is idempotent', () => {
    const job = cron('stop-twice', {
      schedule: { expression: '* * * * * *' },
      run: () => {},
    });

    job[symbols.cron].start(mockServer());
    job.stop();
    expect(() => job.stop()).not.toThrow();
    expect(job.isRunning()).toBe(false);
  });
});
