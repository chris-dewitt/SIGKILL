import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // The wasm engine takes a moment to instantiate the first time.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
