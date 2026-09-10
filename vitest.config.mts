import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.{js,ts}'],
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    reporters: ['dot'],
  },
});
