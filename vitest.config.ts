import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Each workspace keeps its own tests next to the code they cover.
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.{ts,tsx}'],
    // The universal app's component tests are jest-expo's, not vitest's
    // (docs/UNIVERSAL.md foundation 8): they render React Native, whose source
    // vitest cannot parse. Without this they were collected here as well and
    // failed to load — two failed files under a green test count, which is
    // exactly the kind of red that reads as green at a glance.
    exclude: [...configDefaults.exclude, 'apps/app/**/*.test.tsx'],
    environment: 'node',
    globals: false,
    passWithNoTests: true,
  },
})
