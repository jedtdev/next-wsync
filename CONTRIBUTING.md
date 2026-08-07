# Contributing to next-wsync

Thank you for your interest in contributing to **`next-wsync`**! We welcome bug reports, feature requests, documentation improvements, and pull requests from the community.

---

## 🛠️ Development Setup

### 1. Prerequisites
- **Node.js**: v18.0.0 or higher
- **npm**: v9.0.0 or higher

### 2. Fork & Clone
Fork the repository on GitHub, then clone your fork locally:

```bash
git clone https://github.com/jedtdev/next-wsync.git
cd next-wsync
```

### 3. Install Dependencies
Install all project dependencies:

```bash
npm install
```

### 4. Patch Next.js
`next-wsync` requires patching local Next.js headers for WebSocket upgrade handling during development:

```bash
npx next-ws patch
```

---

## 🧪 Testing & Validation

Before submitting any code changes, please ensure that all tests pass and there are no TypeScript compilation errors.

### Run Type Checking
```bash
npm run typecheck
```

### Run Unit Tests
```bash
npm test
```

### Run Tests in Watch Mode
```bash
npm run test:watch
```

### Build Production Bundle
```bash
npm run build
```

---

## 📁 Repository Structure

- **`core/`**: Server-side engine implementation
  - `scope.ts`: `AsyncLocalStorage` engine (`WsyncScope`) and ambient `ctx` Proxy getter
  - `channel.ts`: Channel definition factory, event execution, methods, crons, and Async EventEmitter
  - `server.ts`: WebSocket upgrade handler and server instance registry
  - `storage.ts`: Micro-storage engine and Redis storage adapters
  - `cron.ts`: Background cron task execution via `croner`
  - `utils.ts`: Read-only cookie/header adapters and MongoDB-style query selector logic
  - `types.ts`: TypeScript type definitions and router inference
- **`tests/`**: Vitest test suites
- **`playground/`**: Next.js App Router playground app for testing real-time WebSocket features locally

---

## 📝 Code Guidelines

1. **TypeScript First**: All code must be strictly typed. Avoid `any` where possible.
2. **AsyncLocalStorage Engine**: Ensure all async ticks and callbacks inside event handlers wrap execution inside `scopeStorage.run(scope, ...)`.
3. **No Breaking Changes**: Maintain backwards compatibility for legacy `parameters: { emit, receive }` while prioritizing `schema: { emit, receive, meta }`.
4. **Clean Code & Comments**: Write self-documenting code with clear docstrings explaining rationale.

---

## 🔀 Submitting Pull Requests

1. **Branch Naming**: Use descriptive branch names like `feature/async-context` or `fix/cron-interval`.
2. **Commit Messages**: Keep commit messages clear and concise (e.g. `feat: add redisStorage helper factory`).
3. **Open a PR**: Submit your Pull Request against the `main` branch with a clear description of the changes and motivation.

---

## 📄 License

By contributing to `next-wsync`, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
