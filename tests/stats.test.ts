import { createServer } from 'http';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { z } from 'zod';
import { channel } from '../core/channel';
import { wsync } from '../core/server';

async function createTestServer(api: ReturnType<typeof wsync>) {
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
    api,
    url: (ch: string) => `ws://localhost:${port}/${ch}`,
    close: () =>
      new Promise<void>((r) => {
        wss.clients.forEach((c) => c.terminate());
        wss.close(() => httpServer.close(() => r()));
      }),
  };
}

function connect(url: string): Promise<WebSocket> {
  return new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

describe('api.stats methods', () => {
  let server: Awaited<ReturnType<typeof createTestServer>>;
  const sockets: WebSocket[] = [];

  const chatChannel = channel('chat', {
    schema: {
      emit: z.unknown(),
      receive: z.unknown(),
    },
    events: {
      onConnect(ctx) {
        const role = ctx.params.get('role') ?? 'user';
        ctx.meta.set('role', role);
      },
    },
  });

  const newsChannel = channel('news', {
    schema: {
      emit: z.unknown(),
      receive: z.unknown(),
    },
  });

  beforeEach(async () => {
    const api = wsync([chatChannel, newsChannel]);
    server = await createTestServer(api);
  });

  afterEach(async () => {
    for (const ws of sockets) ws.close();
    sockets.length = 0;
    await server.close();
  });

  it('should reflect connection stats accurately', async () => {
    expect(server.api.stats.getTotal()).toBe(0);
    expect(server.api.stats.getChannelCounts()).toEqual({});
    expect(server.api.stats.getChannelCount('chat')).toBe(0);
    expect(server.api.stats.getIds()).toEqual([]);

    const c1 = await connect(server.url('chat?role=admin'));
    sockets.push(c1);

    expect(server.api.stats.getTotal()).toBe(1);
    expect(server.api.stats.getChannelCount('chat')).toBe(1);
    expect(server.api.stats.getChannelCounts()).toEqual({ chat: 1 });

    const c2 = await connect(server.url('chat?role=member'));
    sockets.push(c2);

    const c3 = await connect(server.url('news'));
    sockets.push(c3);

    expect(server.api.stats.getTotal()).toBe(3);
    expect(server.api.stats.getChannelCount('chat')).toBe(2);
    expect(server.api.stats.getChannelCount('news')).toBe(1);
    expect(server.api.stats.getChannelCounts()).toEqual({ chat: 2, news: 1 });

    const ids = server.api.stats.getIds();
    expect(ids.length).toBe(3);

    const client = server.api.stats.getClient(ids[0]);
    expect(client).toBeDefined();

    const admins = server.api.stats.filter((ws) => (ws as any).meta?.role === 'admin');
    expect(admins.length).toBe(1);

    const queriedAdmins = server.api.stats.query({ role: 'admin' }, 'chat');
    expect(queriedAdmins.length).toBe(1);

    const snapshot = server.api.stats.snapshot('chat');
    expect(snapshot.length).toBe(2);
  });
});
