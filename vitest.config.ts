import { defaultServerConditions } from 'vite'
import { configDefaults, defineConfig } from 'vitest/config'

/**
 * Vitest's own conditions — Vite's server ones without `module`, whose ESM
 * builds (the AWS SDK's) Node cannot load — with `source` first.
 */
const conditions = [
  'source',
  ...defaultServerConditions.filter(condition => condition !== 'module'),
]

export default defineConfig({
  /*
   * The workspace packages, read from their source rather than their `dist`.
   *
   * Each package's `exports` points at `dist/`, which is what Node, tsc, Jest,
   * Metro, esbuild and wrangler read. Left to that, a test that imports
   * `@selfmp3/shared` ran whatever was compiled last, so `test:watch` checked
   * stale code and `npm test` had to build the packages first. Each entry also
   * names its source under a `source` condition, which only this asks for, so
   * every subpath resolves the way the others do without a list kept here.
   * Vite resolves the packages' NodeNext `./foo.js` specifiers back to
   * `./foo.ts` on its own.
   */
  resolve: { conditions },
  ssr: { resolve: { conditions } },
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
    // A server made in a test never downloads the listening model's 750 MB;
    // the sound tests hand theirs a fake model instead.
    env: { SELFMP3_SOUND: 'false' },
    globals: false,
  },
})
