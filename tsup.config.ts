import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'core/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    external: ['next', 'ws', 'zod', 'ioredis'],
  },
  {
    entry: { client: 'core/client.tsx' },
    format: ['esm', 'cjs'],
    dts: true,
    external: ['react', 'react-dom'],
  },
]);
