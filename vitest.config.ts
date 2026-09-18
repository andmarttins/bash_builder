import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/**/*.spec.ts', 'packages/**/*.spec.ts'],
    environment: 'node',
    coverage: {
      reporter: ['text', 'html'],
      include: ['apps/*/src/**/*.ts', 'packages/*/src/**/*.ts']
    }
  }
});

