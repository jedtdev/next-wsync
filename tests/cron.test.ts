import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebSocketServer } from 'ws';
import { cron } from '../core/cron';
import { symbols } from '../core/constants';

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

  it('getLastRun() is null before any run', () => {
    const job = cron('no-run-yet', {
      schedule: { expression: '*/5 * * * *' },
      run: () => {},
    });
    expect(job.getLastRun()).toBeNull();
  });

  it('job runs on schedule and last is populated', async () => {
    const runFn = vi.fn();
    const job = cron('every-second', {
      schedule: { expression: '* * * * * *' },
      run: runFn,
    });

    job[symbols.cron].start(mockServer());

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

  it('job.getLastRun() is populated with timestamps after a run', async () => {
    const job = cron('last-check', {
      schedule: { expression: '* * * * * *' },
      run: () => {},
    });

    job[symbols.cron].start(mockServer());

    await new Promise<void>((resolve) => {
      const start = Date.now();
      const interval = setInterval(() => {
        if (job.getLastRun() !== null || Date.now() - start > 1500) {
          clearInterval(interval);
          resolve();
        }
      }, 50);
    });

    job.stop();
    expect(job.getLastRun()).not.toBeNull();
    expect(job.getLastRun()?.error).toBeNull();
    expect(job.getLastRun()?.timestamps.started).toBeInstanceOf(Date);
    expect(job.getLastRun()?.timestamps.finished).toBeInstanceOf(Date);
    expect(typeof job.getLastRun()?.timestamps.durationMs).toBe('number');
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

  it('job.getLastRun().error is set when run throws', async () => {
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
        if (job.getLastRun() !== null || Date.now() - start > 1500) {
          clearInterval(interval);
          resolve();
        }
      }, 50);
    });

    job.stop();
    expect(job.getLastRun()?.error).toBeInstanceOf(Error);
    expect(job.getLastRun()?.error?.message).toBe('boom');
  });

  it('calling internals.start() twice does not create a second cron instance', () => {
    const runFn = vi.fn();
    const job = cron('idempotent', {
      schedule: { expression: '* * * * * *' },
      run: runFn,
    });

    const server = mockServer();
    job[symbols.cron].start(server);
    job[symbols.cron].start(server);

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
