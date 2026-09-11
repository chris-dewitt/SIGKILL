import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Pyodide takes a few seconds to boot the first time.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
