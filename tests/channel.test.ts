import { createServer } from 'http';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { z } from 'zod';
import { channel } from '../core/channel';
import type { RealtimeApi } from '../core/types';
import { wsync } from '../core/server';

// ── Test helpers ──────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function createTestServer(api: RealtimeApi<any>) {
  const httpServer = createServer();
  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws, req) => {
    const url = `http://localhost${req.url}`;
    const request = new NextRequest(url);
    api(ws as unknown as import('ws').WebSocket, wss, request);
  });

  await new Promise<void>((r) => httpServer.listen(0, r));
  const { port } = httpServer.address() as { port: number };

  return {
    url: (ch: string) => `ws://localhost:${port}/${ch}`,
    close: () =>
      new Promise<void>((r) => {
        wss.clients.forEach((c) => c.terminate());
        wss.close(() => httpServer.close(() => r()));
      }),
  };
}

// The server sends `connected` in the same TCP data callback as the 101 Upgrade
// response (loopback delivers them together), so `message` fires synchronously
// after `open` before any Promise microtasks. Buffer messages in `connect()` so
// `nextMessage()` can pop from the buffer even if it's called after `open`.
const msgBuf = new WeakMap<WebSocket, unknown[]>();
const msgWaiters = new WeakMap<WebSocket, ((v: unknown) => void)[]>();

function connect(url: string): Promise<WebSocket> {
  return new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(url);
    msgBuf.set(ws, []);
    msgWaiters.set(ws, []);
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as unknown;
      const waiters = msgWaiters.get(ws)!;
      if (waiters.length > 0) waiters.shift()!(msg);
      else msgBuf.get(ws)!.push(msg);
    });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function nextMessage(ws: WebSocket): Promise<unknown> {
  const buf = msgBuf.get(ws);
  if (buf && buf.length > 0) return Promise.resolve(buf.shift()!);
  return new Promise<unknown>((resolve) => msgWaiters.get(ws)!.push(resolve));
}

function nextClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) =>
    ws.once('close', (code, reason) =>
      resolve({ code, reason: reason.toString() }),
    ),
  );
}

function send(ws: WebSocket, data: unknown) {
  ws.send(JSON.stringify({ type: 'message', data }));
}

// ── Channel definitions ───────────────────────────────────────

const echoChannel = channel('echo', {
  parameters: {
    emit: z.unknown(),
    receive: z.object({ text: z.string() }),
  },
  events: {
    onMessage(ctx, payload) {
      ctx.reply(payload);
    },
  },
});

const broadcastChannel = channel('broadcast', {
  parameters: {
    emit: z.unknown(),
    receive: z.object({ text: z.string() }),
  },
  events: {
    onMessage(ctx, payload) {
      ctx.broadcast.all(payload);
    },
  },
});

const othersChannel = channel('others', {
  parameters: {
    emit: z.unknown(),
    receive: z.object({ text: z.string() }),
  },
  events: {
    onMessage(ctx, payload) {
      ctx.broadcast.others(payload);
    },
  },
});

const toChannel = channel('targeted', {
  parameters: {
    emit: z.unknown(),
    receive: z.object({ text: z.string(), role: z.string() }),
  },
  events: {
    onMessage(ctx, payload) {
      ctx.broadcast.to({ role: payload.role }, { text: payload.text });
    },
  },
});

const disconnectChannel = channel('disconnect-me', {
  parameters: {
    emit: z.unknown(),
    receive: z.object({ text: z.string() }),
  },
  events: {
    onMessage(ctx) {
      ctx.disconnect();
    },
  },
});

// ── Tests ─────────────────────────────────────────────────────

describe('channel integration', () => {
  let server: Awaited<ReturnType<typeof createTestServer>>;
  const sockets: WebSocket[] = [];

  beforeEach(async () => {
    const api = wsync([
      echoChannel,
      broadcastChannel,
      othersChannel,
      toChannel,
      disconnectChannel,
    ]);
    server = await createTestServer(api);
  });

  afterEach(async () => {
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) ws.terminate();
    }
    sockets.length = 0;
    await server.close();
  });

  function track(...ws: WebSocket[]) {
    sockets.push(...ws);
    return ws;
  }

  it('sends { type: "connected", id } on connect', async () => {
    const [ws] = track(await connect(server.url('echo')));
    const msg = await nextMessage(ws);
    expect(msg).toMatchObject({ type: 'connected', id: expect.any(String) });
  });

  it('connected id is a non-empty string', async () => {
    const [ws] = track(await connect(server.url('echo')));
    const msg = (await nextMessage(ws)) as { type: string; id: string };
    expect(msg.id).toBeTruthy();
  });

  it('onMessage fires and ctx.reply sends back to sender', async () => {
    const [ws] = track(await connect(server.url('echo')));
    await nextMessage(ws); // consume 'connected'
    send(ws, { text: 'hello' });
    const reply = await nextMessage(ws);
    expect(reply).toEqual({ type: 'message', data: { text: 'hello' } });
  });

  it('ctx.broadcast.all sends to all connected clients', async () => {
    const [ws1, ws2] = track(
      await connect(server.url('broadcast')),
      await connect(server.url('broadcast')),
    );
    await nextMessage(ws1); // 'connected'
    await nextMessage(ws2); // 'connected'

    // ws1 sends; both should receive
    const p1 = nextMessage(ws1);
    const p2 = nextMessage(ws2);
    send(ws1, { text: 'hi all' });

    const [m1, m2] = await Promise.all([p1, p2]);
    expect(m1).toEqual({ type: 'message', data: { text: 'hi all' } });
    expect(m2).toEqual({ type: 'message', data: { text: 'hi all' } });
  });

  it('ctx.broadcast.others sends to all except sender', async () => {
    const [ws1, ws2, ws3] = track(
      await connect(server.url('others')),
      await connect(server.url('others')),
      await connect(server.url('others')),
    );
    await nextMessage(ws1);
    await nextMessage(ws2);
    await nextMessage(ws3);

    const p2 = nextMessage(ws2);
    const p3 = nextMessage(ws3);

    send(ws1, { text: 'only others' });

    const [m2, m3] = await Promise.all([p2, p3]);
    expect(m2).toEqual({ type: 'message', data: { text: 'only others' } });
    expect(m3).toEqual({ type: 'message', data: { text: 'only others' } });

    // ws1 should NOT receive a message (with a short timeout)
    const ws1Got = await Promise.race([
      nextMessage(ws1),
      new Promise((r) => setTimeout(() => r('timeout'), 100)),
    ]);
    expect(ws1Got).toBe('timeout');
  });

  it('ctx.broadcast.to(selector) sends only to matching clients', async () => {
    const api2 = wsync([
      channel('targeted2', {
        parameters: {
          emit: z.unknown(),
          receive: z.object({ text: z.string(), role: z.string() }),
        },
        events: {
          onConnect(ctx) {
            // set role from URL search params
            const role = ctx.params.get('role') ?? 'guest';
            ctx.meta.set('role', role);
          },
          onMessage(ctx, payload) {
            ctx.broadcast.to({ role: payload.role }, { text: payload.text });
          },
        },
      }),
    ]);
    const srv2 = await createTestServer(api2);
    const admin = await connect(srv2.url('targeted2') + '?role=admin');
    const guest = await connect(srv2.url('targeted2') + '?role=guest');
    track(admin, guest);

    await nextMessage(admin);
    await nextMessage(guest);

    const pAdmin = nextMessage(admin);

    send(guest, { text: 'admin only', role: 'admin' });

    const mAdmin = await pAdmin;
    expect(mAdmin).toEqual({ type: 'message', data: { text: 'admin only' } });

    // guest should NOT receive
    const guestGot = await Promise.race([
      nextMessage(guest),
      new Promise((r) => setTimeout(() => r('timeout'), 100)),
    ]);
    expect(guestGot).toBe('timeout');

    await srv2.close();
  });

  it('ctx.disconnect() closes the connection from the server', async () => {
    const [ws] = track(await connect(server.url('disconnect-me')));
    await nextMessage(ws); // 'connected'

    const closeP = nextClose(ws);
    send(ws, { text: 'bye' });
    const { code } = await closeP;
    expect(code).toBe(1000);
  });

  it('unknown channel closes with code 1008', async () => {
    const ws = new WebSocket(server.url('nonexistent'));
    track(ws);
    const { code } = await nextClose(ws);
    expect(code).toBe(1008);
  });

  it('invalid message format sends error frame', async () => {
    const [ws] = track(await connect(server.url('echo')));
    await nextMessage(ws); // 'connected'

    // Send wrong type to trigger invalid format error
    ws.send(JSON.stringify({ type: 'wrong', data: {} }));
    const errMsg = (await nextMessage(ws)) as { type: string; reason: string };
    expect(errMsg.type).toBe('error');
    expect(errMsg.reason).toBe('Invalid message format');
  });

  it('validation failure sends error frame with issues', async () => {
    const [ws] = track(await connect(server.url('echo')));
    await nextMessage(ws); // 'connected'

    // echo channel expects { text: string } but we send a number
    send(ws, 42);
    const errMsg = (await nextMessage(ws)) as {
      type: string;
      reason: string;
      issues: unknown;
    };
    expect(errMsg.type).toBe('error');
    expect(errMsg.reason).toBe('Validation failed');
    expect(Array.isArray(errMsg.issues)).toBe(true);
  });
});
