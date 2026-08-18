# next-wsync

A typed, channel-based WebSocket layer for Next.js. Built on top of [`next-ws`](https://github.com/apteryxxyz/next-ws) and the [`ws`](https://github.com/websockets/ws) package.

> Community project — not affiliated with Vercel or Next.js.

## Features

- Typed channels with Zod-validated emit/receive payloads
- Flat MongoDB-style client selection API (`find`, `send`, `update`, `disconnect`)
- Per-channel stores, cron jobs, and reusable methods
- Cross-channel broadcasting with fine-grained targeting
- Redis/Upstash/Valkey pub/sub adapter for horizontal scaling
- `defineAdapter()` factory for custom adapters
- Typed React hook (`useWsync`) and provider with auto-reconnect

## Installation

```bash
npm i next-wsync next-ws && npx next-ws patch
```

`next-ws patch` modifies your local Next.js install to handle WebSocket upgrades. Re-run it after upgrading Next.js, or automate it:

```json
{
  "scripts": {
    "prepare": "next-ws patch"
  }
}
```

## Package exports

| Import path | Contents |
|---|---|
| `next-wsync` | Server-side: `channel`, `wsync`, `storage`, `cron`, adapters, types |
| `next-wsync/client` | Client-side: `createClient`, `useWsync`, `ChannelStatus` |

---

## Quick start

### 1. Define a channel

```ts
// lib/realtime/channels/room.ts
import { z } from 'zod'
import { cookies, headers } from 'next/headers'
import { auth } from '@/auth' // Native NextAuth v5 / Auth.js
import { channel, ctx } from 'next-wsync'

export const roomChannel = channel('room', {
  schema: {
    emit: z.object({
      type: z.literal('message'),
      text: z.string(),
      from: z.string(),
    }),
    receive: z.object({
      type: z.literal('message'),
      text: z.string(),
    }),
    meta: z.object({
      userId: z.string(),
      roomId: z.string(),
    }),
  },
  events: {
    async onConnect() {
      // Native NextAuth & Next.js APIs work out of the box!
      const session = await auth()
      const userAgent = (await headers()).get('user-agent')

      const roomId = ctx.params.get('roomId') ?? 'default'
      ctx.meta.set('roomId', roomId)
      ctx.meta.set('userId', session?.user?.id ?? crypto.randomUUID())

      ctx.reply({ type: 'message', text: 'Welcome!', from: 'system' })
    },
    async onMessage(data) {
      // Ambient ctx access with zero prop drilling!
      ctx.broadcast.others({ type: 'message', text: data.text, from: ctx.client.id })
    },
    async onDisconnect() {
      ctx.broadcast.all({ type: 'message', text: 'A user left', from: 'system' })
    },
  },
})
```

### 2. Create the server handler

```ts
// lib/realtime/index.ts
import { wsync } from 'next-wsync'
import { roomChannel } from './channels/room'

export const api = wsync([roomChannel])
export type AppRouter = typeof api
```

### 3. Mount the route handler

```ts
// app/api/ws/[[...slug]]/route.ts
import { api } from '@/lib/realtime'

export { api as UPGRADE }
```

### 4. Create the client binding

```tsx
// lib/realtime/client.tsx
'use client'
import { createClient } from 'next-wsync/client'
import type { AppRouter } from './index'

export const { NextWsyncProvider, useWsync } = createClient<AppRouter>('/api/ws')
```

### 5. Consume the hook

```tsx
// app/room/page.tsx
'use client'
import { NextWsyncProvider, useWsync } from '@/lib/realtime/client'

function RoomChat() {
  const { send, status, id } = useWsync('room', {
    parameters: { roomId: 'lobby' },
    events: {
      onMessage(data) {
        console.log(data.text, data.from)
      },
    },
  })

  return (
    <div>
      <p>Status: {status} — ID: {id}</p>
      <button onClick={() => send({ type: 'message', text: 'Hello!' })}>
        Send
      </button>
    </div>
  )
}

export default function Page() {
  return (
    <NextWsyncProvider>
      <RoomChat />
    </NextWsyncProvider>
  )
}
```

---

## Server API

### `channel(name, def)`

Defines a typed channel. All event handlers receive a fully typed `ctx` object derived from the channel definition.

```ts
import { channel } from 'next-wsync'

const myChannel = channel('chat', {
  // `parameters` + top-level `meta` (below) or `schema: { emit, receive, meta }`
  // (as in the Quick start example) are interchangeable — use whichever reads better.
  parameters: {
    emit:    z.object({ ... }),   // data shape sent to clients
    receive: z.object({ ... }),   // data shape accepted from clients
  },
  meta:    z.object({ ... }),     // per-socket metadata schema
  stores:  [counterStore],        // typed storage instances
  pubsub:  true,                  // enable cross-instance pub/sub
  methods: (ctx) => ({            // reusable server-side helpers
    greet: (name: string) => ctx.broadcast.all({ type: 'greeting', text: `Hi ${name}` }),
  }),
  crons: {                        // declarative channel-scoped cron jobs
    heartbeat: {
      schedule: '*/5 * * * * *',
      run: () => myChannel.methods.greet('cron'),
    },
  },
  events: {
    onConnect(ctx) {},
    onMessage(ctx, data) {},
    onDisconnect(ctx) {},
    onError(ctx, error) {},
  },
})

// Access bound methods from outside event handlers
myChannel.methods.greet('world')

// Control a declared cron job from outside event handlers
myChannel.crons.heartbeat.start()
myChannel.crons.heartbeat.stop()
myChannel.crons.heartbeat.isRunning()
```

**`channel.clone(newName)`** — Copy a channel definition under a new name.

```ts
const adminChannel = myChannel.clone('admin-chat')
```

### Channel context (`ctx`)

Every event handler receives a `ctx` object with the following shape:

| Property | Type | Description |
|---|---|---|
| `ctx.client` | `WebSocket & { id: string; iat: number; meta: TMeta }` | The connected socket. `id` is server-assigned; `iat` is connect time (unix ms) |
| `ctx.server` | `WebSocketServer` | The underlying ws server |
| `ctx.channel` | `string` | Name of this channel |
| `ctx.params` | `URLSearchParams` | Query params from the connection URL |
| `ctx.request` | `NextRequest` | The HTTP upgrade request |
| `ctx.stores` | `InferStores<TStores>` | Typed access to this channel's stores |
| `ctx.meta` | `MetaAccessor<TMeta>` | Read/write the socket's metadata bag |
| `ctx.reply(data)` | `(data: TEmit) => void` | Send to this client only |
| `ctx.broadcast` | `ChannelBroadcast` | Broadcast to matching clients (see below) |
| `ctx.disconnect(code?, reason?)` | `() => void` | Disconnect this socket |
| `ctx.clients` | `ClientsAccessor` | Flat client selection API (see below) |
| `ctx.crons` | `{ [name]: CronControl }` | Control this channel's declared cron jobs (`.start()`, `.stop()`, `.trigger()`, `.isRunning()`, `.getLastRun()`, `.getNextRun()`) |
| `ctx.cookies` | `ReadonlyRequestsCookies` | Cookies from the upgrade request |
| `ctx.headers` | `ReadonlyHeaders` | Headers from the upgrade request |
| `ctx.log` | `ScopeLogger` | Ambient scope logger (see [Debugging & Logging](#debugging--logging)) |

#### `ctx.meta`

```ts
ctx.meta.set('role', 'admin')                          // set a single key
ctx.meta.set(prev => ({ ...prev, score: prev.score + 1 }))  // updater fn
ctx.meta.get('role')                                    // TMeta['role'] | undefined
ctx.meta.get('role', 'guest')                           // TMeta['role'] — never undefined
ctx.meta.original                                       // raw meta object reference
```

### `ctx.clients` — Flat client selection

Each method takes a MongoDB-style selector and returns the matched sockets as `WebSocket[]`, enabling standard array operations on the result.

```ts
// Find matching sockets (returns WebSocket[])
const admins = ctx.clients.find({ role: 'admin' })
admins.forEach(ws => console.log(ws.id, ws.meta))

// Send data to matching sockets (returns matched WebSocket[])
ctx.clients.send({ role: 'admin' }, { type: 'notice', text: 'Hello admins' })

// Update meta on matching sockets (returns matched WebSocket[])
ctx.clients.update({ userId: '123' }, { banned: true })

// Update meta with an updater function
ctx.clients.update({ room: 'lobby' }, prev => ({ ...prev, score: prev.score + 1 }))

// Disconnect matching sockets (returns matched WebSocket[])
ctx.clients.disconnect({ banned: true }, { code: 1008, reason: 'Banned' })

// Count connected clients on this channel
ctx.clients.size
```

**`ClientsAccessor` methods:**

| Method | Returns | Description |
|---|---|---|
| `.find(selector)` | `WebSocket[]` | Return all sockets matching the selector |
| `.send(selector, data)` | `WebSocket[]` | Send typed data to matching sockets |
| `.update(selector, patch \| updater)` | `WebSocket[]` | Patch meta on matching sockets |
| `.disconnect(selector, opts?)` | `WebSocket[]` | Close matching sockets |
| `.size` | `number` | Total clients on this channel |

### `ctx.broadcast`

```ts
// Same-channel broadcasts
ctx.broadcast.all(data)                          // all clients on this channel
ctx.broadcast.others(data)                       // all except sender
ctx.broadcast.to({ role: 'admin' }, data)        // matching clients
ctx.broadcast.except({ muted: true }, data)      // all but matching
ctx.broadcast.all(data, { except: { bot: true } }) // with exclusion option

// Cross-channel broadcasts
ctx.broadcast.channel('lobby').all(data)
ctx.broadcast.channel('lobby').to({ ready: true }, data)
ctx.broadcast.channel('lobby').except({ idle: true }, data)
```

### Selectors

Selectors can match `id` and `iat` (built-ins on every socket) as well as any key in `client.meta`. Multiple keys are AND-ed.

```ts
{ id: 'abc-123' }                    // match by server-assigned socket ID
{ iat: { $lt: Date.now() - 60_000 } } // connected less than 60s ago
{ role: 'admin' }                    // equality shorthand (implicit $eq)
{ role: { $eq: 'admin' } }
{ role: { $ne: 'guest' } }
{ tier: { $in: ['pro', 'max'] } }
{ tier: { $nin: ['free'] } }
{ score: { $gt: 10 } }              // also $gte, $lt, $lte — numeric only
{ name: { $exists: true } }
{ role: 'admin', room: 'lobby' }    // AND — both must match
```

### `wsync(channels, options?)`

Assembles channels into a server handler.

```ts
import { wsync } from 'next-wsync'

export const api = wsync([roomChannel, adminChannel], {
  jobs:    [globalHeartbeat],    // global cron jobs
  adapter: redis('redis://...'), // pub/sub adapter
})

export type AppRouter = typeof api
```

The returned `api` object is callable as `(client, server, request) => void`. Export it as `UPGRADE` from a Next.js route handler — `next-ws` will invoke it on every WebSocket upgrade.

```ts
// app/api/ws/[[...slug]]/route.ts
import { api } from '@/lib/realtime'
export { api as UPGRADE }
```

**`api.stats`** — Runtime connection statistics:

```ts
api.channels                            // ReadonlySet<string>

const stats = api.stats
stats.total()                           // total connected clients
stats.channel()                         // { [channelName]: count }
stats.channel('room')                   // count for one channel
stats.ids()                             // string[] — all socket IDs
stats.get(id)                           // WebSocket | undefined
stats.filter(ws => ws.meta.role === 'admin') // WebSocket[]
stats.query({ role: 'admin' }, 'room')  // selector query, optional channel scope
stats.snapshot('room')                  // [{ id, meta }]
```

---

## Storage

### `storage(name, def)`

Creates a typed, per-channel state store scoped to a channel instance.

```ts
import { storage } from 'next-wsync'

const counterStore = storage('counter', {
  store: () => ({ n: 0 }),           // factory fn (or plain value)
  methods: (s) => ({
    inc:   () => ++s.n,
    dec:   () => --s.n,
    value: () => s.n,
  }),
  middleware: {
    onCall(name, args) {
      console.log(`Calling ${name}`, args)
    },
    onResult(name, args, result) {
      console.log(`${name} returned`, result)
    },
    onError(name, args, error) {
      console.error(`${name} threw`, error)
    },
  },
})

// Use in a channel definition
const myChannel = channel('demo', {
  stores: [counterStore],
  events: {
    onMessage(ctx) {
      ctx.stores.counter.inc()
      ctx.reply({ count: ctx.stores.counter.value() })
    },
  },
})
```

**`storage.clone(name?)`** — Fresh state (separate instance).
**`storage.ref(name?)`** — Shared state (same underlying object).

---

## Cron jobs

### Channel crons — `crons` in the channel definition

The preferred way to schedule work scoped to a specific channel. Declare jobs under `crons` in `channel()` — each key becomes a named job, and the ambient `ctx` (imported from `next-wsync`) is available inside `run`/`onError` just like in event handlers.

```ts
import { channel, ctx } from 'next-wsync'

const roomChannel = channel('room', {
  // ...
  crons: {
    heartbeat: {
      schedule: '*/5 * * * * *',   // string, or { expression, tz }
      run() {
        ctx.broadcast.all({ type: 'tick', ts: Date.now() })
      },
      onError(err) {
        console.error('heartbeat failed', err)
      },
    },
  },
})

// Control a declared job from outside event handlers
roomChannel.crons.heartbeat.start()
roomChannel.crons.heartbeat.stop()
await roomChannel.crons.heartbeat.trigger()
roomChannel.crons.heartbeat.isRunning()   // boolean
roomChannel.crons.heartbeat.getLastRun()  // CronJobLast | null
roomChannel.crons.heartbeat.getNextRun()  // Date | null
```

**Ambient `ctx` inside `run`/`onError`:**

| Property | Description |
|---|---|
| `ctx.channel` | Channel name (typed) |
| `ctx.stores` | Typed stores for this channel |
| `ctx.clients` | `ClientsAccessor` — same flat API as in event handlers |
| `ctx.broadcast.all(data)` | Broadcast to all channel clients |
| `ctx.broadcast.to(selector, data)` | Broadcast to matching clients |
| `ctx.broadcast.except(selector, data)` | Broadcast excluding matches |
| `ctx.broadcast.channel(name)` | Cross-channel broadcast |
| `ctx.stop()` | Stop this job |

### Global crons — `cron()`

For jobs not scoped to any particular channel. Pass them to `wsync` via `options.jobs`.

```ts
import { cron, wsync } from 'next-wsync'

const globalCleanup = cron('cleanup', {
  schedule: { expression: '0 * * * *' },  // every hour
  run(ctx) {
    ctx.broadcast.all({ type: 'ping' })
  },
  onError(ctx, err) {
    console.error('cleanup failed', err)
  },
})

export const api = wsync([roomChannel], { jobs: [globalCleanup] })
```

**Global job context (`ctx` inside `run`):**

| Property | Description |
|---|---|
| `ctx.server` | `WebSocketServer` |
| `ctx.channel` | `string \| null` (null for global jobs) |
| `ctx.stores` | Typed stores |
| `ctx.broadcast.all(data)` | Broadcast to all connected clients |
| `ctx.broadcast.to(selector, data)` | Broadcast to matching clients |
| `ctx.broadcast.except(selector, data)` | Broadcast excluding matches |
| `ctx.stop()` | Stop this job |

**Job inspection:**

```ts
const job = globalCleanup
job.getLastRun()  // { arguments: null, error: Error | null, timestamps: { started, finished, durationMs } } | null
job.isRunning()   // boolean
job.getNextRun()  // Date | null
```

---

## Adapters

Adapters enable horizontal scaling by routing pub/sub messages across multiple Node instances via a shared message broker.

### Built-in adapters

All built-in adapters use `ioredis` under the hood. `upstash` and `valkey` are aliases for `redis` with identical behaviour.

```ts
import { redis, upstash, valkey } from 'next-wsync'

// Connection URL string
wsync(channels, { adapter: redis('redis://localhost:6379') })

// With ioredis options
wsync(channels, { adapter: redis('redis://localhost:6379', { connectTimeout: 5_000 }) })

// Upstash (TLS)
wsync(channels, { adapter: upstash('rediss://default:token@host:6380') })

// Valkey
wsync(channels, { adapter: valkey('redis://valkey-host:6379') })

// Pass an existing ioredis client instance
import Redis from 'ioredis'
const client = new Redis()
wsync(channels, { adapter: redis(client) })
```

### Custom adapter via `defineAdapter`

```ts
import { defineAdapter } from 'next-wsync'

const myAdapter = defineAdapter({
  // Called once; return value is cached and passed to all other methods
  connect: () => createMyConnection(),

  async publish(conn, channel, data) {
    await conn.publish(channel, JSON.stringify(data))
  },

  subscribe(conn, channel, handler) {
    conn.on(channel, (raw) => handler(JSON.parse(raw)))
  },

  unsubscribe(conn, channel) {
    conn.off(channel)
  },

  async close(conn) {
    await conn.quit()
  },
})

wsync(channels, { adapter: myAdapter })
```

### Implementing `PubSubAdapter` directly

If you don't need the `defineAdapter` factory (e.g., you're managing connection lifecycle yourself):

```ts
import type { PubSubAdapter } from 'next-wsync'

const myAdapter: PubSubAdapter = {
  async publish(channel, data) { /* ... */ },
  subscribe(channel, handler) { /* ... */ },
  unsubscribe(channel) { /* ... */ },
  async close() { /* ... */ },
}

wsync(channels, { adapter: myAdapter })
```

---

## Client API

### `createClient<TRouter>(url)`

Creates a typed `NextWsyncProvider` and `useWsync` hook bound to your server's router type.

```tsx
// lib/realtime/client.tsx
'use client'
import { createClient } from 'next-wsync/client'
import type { AppRouter } from './index'   // typeof api

export const { NextWsyncProvider, useWsync } = createClient<AppRouter>('/api/ws')
```

### `<NextWsyncProvider>`

Wrap your component tree (or subtree) with this provider. It pools WebSocket connections — multiple components subscribed to the same channel with the same parameters share a single underlying socket.

```tsx
// app/layout.tsx
import { NextWsyncProvider } from '@/lib/realtime/client'

export default function Layout({ children }) {
  return (
    <html>
      <body>
        <NextWsyncProvider>{children}</NextWsyncProvider>
      </body>
    </html>
  )
}
```

### `useWsync(channel, options?)`

```tsx
const { send, status, id } = useWsync('room', {
  parameters: { roomId: 'abc' },    // appended as URL query params; also used as pool key
  maxRetries: 10,                   // max reconnect attempts — default: Infinity
  protocols: 'my-subprotocol',      // optional WebSocket subprotocol(s)
  events: {
    onOpen() {},
    onClose() {},
    onError(event) {},
    onConnect(id) {},               // fired with server-assigned socket ID
    onReconnect(attempt) {},        // fired on each reconnect attempt
    onMessage(data) {},             // typed from channel's emit schema
  },
})

send({ type: 'message', text: 'Hello' })  // typed from channel's receive schema
```

**Return value:**

| Field | Type | Description |
|---|---|---|
| `send` | `(data: TReceive) => void` | Send a typed message to the server |
| `status` | `ChannelStatus` | Current connection state |
| `id` | `string \| null` | Server-assigned socket ID (available after `onConnect`) |
| `subscribe` | `(cb: (data: TEmit) => void) => () => void` | Register an additional message listener imperatively; returns an unsubscribe function |

```tsx
const { subscribe } = useWsync('room')

useEffect(() => subscribe((data) => console.log(data)), [subscribe])
```

### `ChannelStatus`

```ts
type ChannelStatus = 'connecting' | 'open' | 'closed' | 'error' | 'reconnecting'
```

The hook reconnects automatically with exponential backoff and jitter, capped at 30 seconds. Reconnection is suppressed when the server initiates a clean disconnect.

---

## Debugging & Logging

`next-wsync` provides built-in debug logging with colored Next.js CLI terminal formatting.

### Enabling Debug Logs

You can enable debug logging directly in `wsync()` or via environment variables:

```ts
// Option 1: In wsync options
export const api = wsync([roomChannel], {
  debug: true, // true | 'verbose' | 'minimal' | false
})

// Option 2: Custom logger integration (e.g. Winston, Pino, Datadog)
export const api = wsync([roomChannel], {
  debug: true,
  logger: (level, tag, message, meta) => {
    myCustomLogger.log(level, `[${tag}] ${message}`, meta)
  },
})
```

Or enable via environment variable in `.env.local` or Next.js CLI:
```bash
NEXT_WSYNC_DEBUG=1
# or
DEBUG=next-wsync
```

### Scope Logger (`ctx.log`)

Inside any channel event handler, method, or cron job, you can emit ambient debug logs:

```ts
events: {
  async onConnect() {
    ctx.log.info('Client connected', { clientId: ctx.client.id })
    ctx.log.debug('Inspecting headers', ctx.headers)
  },
  async onMessage(data) {
    ctx.log.info('Processing message', data)
  },
}
```

Call `ctx.log.child('subTag')` to derive a scoped logger with an appended tag.

---

## Wire protocol

These are the raw message shapes exchanged over the WebSocket. You do not need to handle them directly — the hook and server context abstract them away.

**Server to client:**

```ts
{ type: 'connected', id: string }            // emitted immediately on upgrade
{ type: 'message',   data: TEmit }           // user-defined channel payload
{ type: 'error',     reason: string, issues?: unknown }  // validation or server error
```

**Client to server:**

```ts
{ type: 'message', data: TReceive }          // user-defined channel payload
```

---

## Type reference

### Inference utilities

```ts
import type { Infer, InferRouter, RouterEmit, RouterReceive } from 'next-wsync'

// Infer the full router type from an api instance
type AppRouter = Infer<typeof api>

// Infer channel-level emit/receive from a router
type RoomEmit    = RouterEmit<AppRouter, 'room'>
type RoomReceive = RouterReceive<AppRouter, 'room'>
```

### Exported types

| Type | Description |
|---|---|
| `Channel<TName, TEmit, TReceive>` | Return type of `channel()` before the methods/crons namespaces are attached |
| `ChannelContext<TName, TEmit, TStores, TMeta, TCrons>` | Full context object passed to event handlers |
| `ClientsAccessor<TEmit, TMeta>` | The `ctx.clients` object |
| `DisconnectOptions` | `{ code?: number, reason?: string }` |
| `BroadcastOptions` | `{ except?: QuerySelector<TMeta> }` |
| `QuerySelector<TMeta>` | MongoDB-style selector object (includes built-in `id` and `iat` fields) |
| `QueryOp` | Union of supported operator keys (`$eq`, `$ne`, `$in`, etc.) |
| `ChannelBroadcast<TEmit, TMeta>` | Same-channel broadcast methods |
| `CronBroadcast<TEmit, TMeta>` | Broadcast methods available in cron contexts |
| `CronContext<TName, TEmit, TStores, TMeta>` | Ambient `ctx` shape inside a channel cron's `run`/`onError` |
| `CronControl` | `{ start(), stop(), trigger(), isRunning(), getLastRun(), getNextRun() }` — `channel.crons.<name>` / `ctx.crons.<name>` |
| `CrossChannelBroadcast` | Return type of `ctx.broadcast.channel()` |
| `MetaAccessor<TMeta>` | `ctx.meta` object shape |
| `ChannelMethodCtx<TEmit, TStores, TMeta>` | Context passed to the `methods` factory |
| `WsyncChannel<TChannel, TMethodDefs, TCrons>` | Channel type with `.methods` and `.crons` namespaces |
| `RawContext<TName>` | Internal per-connection context passed to `ChannelInternals` handlers |
| `WsyncScope` | Shape of the AsyncLocalStorage-backed scope behind ambient `ctx` |
| `PubSubAdapter` | Interface for custom pub/sub adapters |
| `AdapterDef` | Argument shape for `defineAdapter()` |
| `WsyncOptions` | Options for `wsync()` |
| `Stats` | Shape of `api.stats` |
| `Infer<TApi>` | Extract router type from an `api` instance |
| `InferRouter` | Low-level router inference helper |
| `RouterEmit<TRouter, TChannel>` | Emit payload type for a specific channel |
| `RouterReceive<TRouter, TChannel>` | Receive payload type for a specific channel |
| `ServerMessage<TEmit>` | Raw server-to-client wire message |
| `ClientMessage<TReceive>` | Raw client-to-server wire message |
| `PubSubMessage` | Internal pub/sub envelope |
| `CronJob` | Standalone cron job instance type (`cron()` return value) |
| `CronJobLast` | Shape returned by `job.getLastRun()` |
| `JobContext` | Context passed to standalone `cron()` run callbacks |
| `Schedule` | `string \| { expression: string, tz?: string }` |
| `StorageInstance` | Return type of `storage()` |
| `InferStores<TStores>` | Infer typed store methods from a store array |
| `MethodMap` | Shape of the object returned by the `methods` factory |
| `StorageMiddleware` | `{ onCall(method, args), onResult(method, args, result), onError(method, args, error) }` |
| `ChannelStatus` | `'connecting' \| 'open' \| 'closed' \| 'error' \| 'reconnecting'` |
| `DebugOption` | `wsync()`'s `debug` option type (`true \| 'verbose' \| 'minimal' \| false`) |
| `LoggerOptions` | Options accepted by `Logger`/`wsync({ logger })` |
| `LogLevel` | Union of supported log levels |
| `ScopeLogger` | Shape of `ctx.log`, incl. `.child(subTag)` |

---

## Contributing

Contributions are welcome! Please check out our [Contributing Guide](./CONTRIBUTING.md) for instructions on setting up the repository, running tests, and submitting pull requests.

---

## License

[MIT License](./LICENSE) © 2026 Jed Terrazola
