import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    // The export tests run Typst and EPUBCheck, which take a few seconds each.
    testTimeout: 180_000,
    hookTimeout: 180_000,
    pool: 'forks',
  },
});
