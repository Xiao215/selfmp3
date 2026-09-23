import { fileURLToPath } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  resolve: {
    // The workspace packages, read from their source rather than their `dist`.
    //
    // Each package's `exports` points at `dist/`, which is what Node and tsc
    // want. Left to that, a test that imports `@selfmp3/shared` ran whatever
    // was compiled last, so `test:watch` checked stale code and `npm test` had
    // to build the packages first. Vite resolves the packages' NodeNext
    // `./foo.js` specifiers back to `./foo.ts` on its own. The longer, deeper
    // entry comes before the bare package name, so it is matched first.
    alias: [
      { find: '@selfmp3/client/core', replacement: here('./packages/client/src/core.ts') },
      { find: '@selfmp3/client', replacement: here('./packages/client/src/index.ts') },
      { find: '@selfmp3/shared', replacement: here('./packages/shared/src/index.ts') },
      { find: '@selfmp3/replica', replacement: here('./packages/replica/src/index.ts') },
      {
        find: '@selfmp3/desktop-bridge',
        replacement: here('./packages/desktop-bridge/src/index.ts'),
      },
    ],
  },
  test: {
    // Each workspace keeps its own tests next to the code they cover.
    include: [
      'packages/*/src/**/*.test.ts',
      'apps/*/src/**/*.test.{ts,tsx}',
      // The desktop shell's build scripts are plain .mjs outside every
      // tsconfig, and one of them resolves the Electron binary — which is a
      // per-platform answer, and was wrong.
      'apps/*/scripts/**/*.test.mjs',
      // The repository's own scripts, likewise: the `.env` reader among them.
      'scripts/**/*.test.mjs',
    ],
    // The universal app's component tests are jest-expo's, not vitest's
    // (docs/ARCHITECTURE.md foundation 8): they render React Native, whose source
    // vitest cannot parse. Without this they were collected here as well and
    // failed to load — two failed files under a green test count, which is
    // exactly the kind of red that reads as green at a glance.
    exclude: [...configDefaults.exclude, 'apps/app/**/*.test.tsx'],
    environment: 'node',
    globals: false,
  },
})
