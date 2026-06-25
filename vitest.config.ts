import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['core/**/*.ts'],
      exclude: ['core/client.tsx', 'core/adapters/**'],
    },
  },
});
