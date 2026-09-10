import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Each workspace keeps its own tests next to the code they cover.
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.{ts,tsx}'],
    environment: 'node',
    globals: false,
    passWithNoTests: true,
  },
})
