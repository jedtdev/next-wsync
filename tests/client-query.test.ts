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

function nextClose(ws: WebSocket): Promise<{ code: number }> {
  return new Promise((resolve) =>
    ws.once('close', (code) => resolve({ code })),
  );
}

function send(ws: WebSocket, data: unknown) {
  ws.send(JSON.stringify({ type: 'message', data }));
}

// ── Channel definition ────────────────────────────────────────

describe('ClientsAccessor flat API via channel integration', () => {
  let server: Awaited<ReturnType<typeof createTestServer>>;
  const sockets: WebSocket[] = [];

  const queryChannel = channel('query', {
    schema: {
      emit: z.unknown(),
      receive: z.object({
        action: z.string(),
        selector: z.record(z.unknown()).optional(),
        patch: z.record(z.unknown()).optional(),
        data: z.unknown().optional(),
      }),
    },
    events: {
      onConnect(ctx) {
        const role = ctx.params.get('role') ?? 'guest';
        ctx.meta.set('role', role);
      },
      onMessage(ctx, payload) {
        const sel = (payload.selector ?? {}) as Record<string, unknown>;

        if (payload.action === 'size') {
          ctx.reply({ size: ctx.clients.size });

        } else if (payload.action === 'find') {
          const matched = ctx.clients.find(sel);
          ctx.reply({ count: matched.length });

        } else if (payload.action === 'send') {
          const sent = ctx.clients.send(sel, payload.data);
          ctx.reply({ sent: sent.length });

        } else if (payload.action === 'update') {
          const updated = ctx.clients.update(sel, payload.patch ?? {});
          ctx.reply({ updated: updated.length, meta: ctx.meta.original });

        } else if (payload.action === 'disconnect-victim') {
          const kicked = ctx.clients.disconnect({ role: 'victim' } as Record<string, unknown>, { code: 4099 });
          ctx.reply({ kicked: kicked.length });
        }
      },
    },
  });

  beforeEach(async () => {
    const api = wsync([queryChannel]);
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

  it('clients.size returns the number of connected clients', async () => {
    const [ws1, ws2] = track(
      await connect(server.url('query') + '?role=user'),
      await connect(server.url('query') + '?role=user'),
    );
    await nextMessage(ws1);
    await nextMessage(ws2);

    send(ws1, { action: 'size' });
    const res = (await nextMessage(ws1)) as { type: string; data: { size: number } };
    expect(res.data.size).toBe(2);
  });

  it('clients.find() returns matching clients as array', async () => {
    const [ws1, ws2] = track(
      await connect(server.url('query') + '?role=admin'),
      await connect(server.url('query') + '?role=admin'),
    );
    await nextMessage(ws1);
    await nextMessage(ws2);

    send(ws1, { action: 'find', selector: { role: 'admin' } });
    const res = (await nextMessage(ws1)) as { type: string; data: { count: number } };
    expect(res.data.count).toBe(2);
  });

  it('clients.find() returns empty array when no match', async () => {
    const [ws1] = track(await connect(server.url('query') + '?role=user'));
    await nextMessage(ws1);

    send(ws1, { action: 'find', selector: { role: 'ghost' } });
    const res = (await nextMessage(ws1)) as { type: string; data: { count: number } };
    expect(res.data.count).toBe(0);
  });

  it('clients.send() delivers messages and returns matched clients', async () => {
    const [ws1, ws2] = track(
      await connect(server.url('query') + '?role=receiver'),
      await connect(server.url('query') + '?role=receiver'),
    );
    await nextMessage(ws1);
    await nextMessage(ws2);

    const p1 = nextMessage(ws1);
    const p2 = nextMessage(ws2);

    send(ws1, { action: 'send', selector: { role: 'receiver' }, data: { text: 'hi' } });

    const [m1, m2] = await Promise.all([p1, p2]);
    expect(m1).toEqual({ type: 'message', data: { text: 'hi' } });
    expect(m2).toEqual({ type: 'message', data: { text: 'hi' } });

    const sentRes = (await nextMessage(ws1)) as { type: string; data: { sent: number } };
    expect(sentRes.data.sent).toBe(2);
  });

  it('clients.update() mutates meta and returns matched clients', async () => {
    const [ws1] = track(await connect(server.url('query') + '?role=updateme'));
    await nextMessage(ws1);

    send(ws1, { action: 'update', selector: { role: 'updateme' }, patch: { extra: 'patched' } });
    const res = (await nextMessage(ws1)) as { type: string; data: { updated: number; meta: Record<string, unknown> } };
    expect(res.data.updated).toBe(1);
    expect(res.data.meta.extra).toBe('patched');
  });

  it('clients.disconnect() closes matched sockets and returns them', async () => {
    const [ws1, ws2] = track(
      await connect(server.url('query') + '?role=controller'),
      await connect(server.url('query') + '?role=victim'),
    );
    await nextMessage(ws1);
    await nextMessage(ws2);

    const closeP = nextClose(ws2);
    send(ws1, { action: 'disconnect-victim' });

    const kickRes = (await nextMessage(ws1)) as { type: string; data: { kicked: number } };
    expect(kickRes.data.kicked).toBe(1);

    const { code } = await closeP;
    expect(code).toBe(4099);
  });

  it('clients.find() by id returns that specific client', async () => {
    const [ws1] = track(await connect(server.url('query') + '?role=solo'));
    const connMsg = (await nextMessage(ws1)) as { type: string; id: string };
    const clientId = connMsg.id;

    send(ws1, { action: 'find', selector: { id: clientId } });
    const res = (await nextMessage(ws1)) as { type: string; data: { count: number } };
    expect(res.data.count).toBe(1);
  });
});
