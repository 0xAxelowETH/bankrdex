import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only scan source folders: `.next` is rewritten by the dev server while tests run, which
    // intermittently made every test file fail to load.
    include: ['src/**/*.test.ts', 'app/**/*.test.ts'],
    exclude: ['node_modules', '.next', 'dist'],
  },
});
