# Changelog

All notable changes to `next-wsync` will be documented in this file.

## [0.3.0-beta.1] - 2026-08-18

### ✨ New

- **`useWsync().subscribe(cb)`**: register an additional message listener imperatively (e.g. from a `useEffect`) without going through the hook's `events.onMessage` option; returns an unsubscribe function.

### ⚠️ Breaking Renames

No external consumers yet, so these ship without a deprecation shim.

- **Client API**: `create()` → `createClient()`, `RealtimeProvider` → `NextWsyncProvider`, `useRealtime` → `useWsync`. Exported types `RealtimeOptions`/`RealtimeChannel`/`RealtimeApi` → `WsyncOptions`/`WsyncChannel`/`WsyncApi`, aligning names with the `next-wsync` package name.
- **Cron API**: `job.last` → `job.getLastRun()`, `job.nextRun()` → `job.getNextRun()`, matching `isRunning()` as consistent method-style accessors on `CronJob`.

### 📝 Docs

- Corrected the README's channel-cron section — `channel.cron()` never existed; crons are declared via the `crons` def option and controlled through `channel.crons.<name>`.
- Fixed several other README/source drifts: `job.last` shape, `useRealtime` event handler signatures, storage middleware callback arity, the `ctx` property table, and the exported-types table.

### 🛠 Tooling

- Playground app now resolves `@jedtdev/next-wsync` via an npm workspace `file:` link instead of a stale packed tarball, so it always tracks local source.
- Bumped `next-ws` to `2.2.11` and aligned the dev-only `next` version pin with the playground app to avoid duplicate-package type conflicts.

## [0.2.0] - 2026-08-07

### 🚀 Major Features & Architectural Refactor

- **AsyncLocalStorage Engine (`WsyncScope`)**:
  - Re-architected `next-wsync` core around Node's `node:async_hooks` `AsyncLocalStorage`.
  - Maintains execution context across all async boundaries, microtasks, and `Promise.all` chains.

- **Native Next.js & NextAuth/Auth.js Integration**:
  - Native `cookies()` and `headers()` (from `next/headers`) work out-of-the-box inside channel handlers.
  - Native `auth()` (from NextAuth v5 / Auth.js) works seamlessly to resolve user sessions from WebSocket handshake cookies.

- **Ambient `ctx` Proxy (`import { ctx } from 'next-wsync'`)**:
  - Top-level ambient `ctx` Proxy getter provides direct property access (`ctx.broadcast`, `ctx.client`, `ctx.meta`, `ctx.stores`, `ctx.crons`, `ctx.clients`) anywhere in the codebase without prop-drilling.

- **Unified `schema` Definition**:
  - Consolidated Zod data validation contracts under `schema: { emit, receive, meta }` for clean 5-section channel blueprints (`schema`, `stores`, `crons`, `methods`, `events`).

- **Direct `methods` Object Syntax**:
  - Custom channel methods can be declared directly as an object (`methods: { [name]: fn }`) without factory wrappers.

- **Declarative Object `crons` with Static Type Inference**:
  - Crons declared in `crons: { [name]: { schedule, run, onError } }` inherit channel store types and expose autocompleted controls (`start()`, `stop()`, `trigger()`, `running`) on `ctx.crons.<name>` and `channel.crons.<name>`.

- **Typed Async EventEmitter (`channel.on()`)**:
  - Programmatic `.on(eventName, listener)` event subscriptions running concurrently in the active `AsyncLocalStorage` scope.

- **Dual-Mode `Promise<void>` Broadcasting**:
  - All `broadcast` methods return `Promise<void>` allowing non-blocking fire-and-forget execution by default, or optional `await` for Redis/PubSub network delivery confirmation.

---

## [0.1.0] - 2026-08-07

### 🎉 Initial Release

- **Typed Channels**: Zod-validated emit/receive payloads and metadata schemas.
- **Client Selection Engine**: MongoDB-style query operators (`find`, `send`, `update`, `disconnect`).
- **Channel Storage & Micro-Stores**: Per-channel state storage with custom methods and middleware.
- **Background Cron Execution**: Per-channel background cron task scheduling via `croner`.
- **PubSub Adapter Integration**: Multi-node horizontal scaling support via Redis, Upstash, and Valkey.
- **Client Library (`next-wsync/client`)**: React `useRealtime` hook, `ChannelStatus` indicators, and automatic reconnection manager.
