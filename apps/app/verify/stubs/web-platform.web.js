// Spike-only stand-in for apps/web/src/lib/platform.ts in the Metro web bundle.
//
// platform.ts is the one module in apps/web that reads `import.meta.env` —
// Vite's, which Metro does not provide, so evaluating it throws
// "Cannot read properties of undefined (reading 'BASE_URL')" and the app never
// renders. Six references, all in that one file, which is the good news: the
// Vite boundary is a single module and it is already named for what it is.
//
// docs/UNIVERSAL.md anticipates the replacement (`EXPO_PUBLIC_CLOUD=1` for
// `VITE_CLOUD=1`); phase 1 moves this into packages/client reading
// `process.env.EXPO_PUBLIC_*`, which Expo inlines at build time on every
// platform. `BASE_URL` gets the same treatment via `EXPO_PUBLIC_BASE`, which
// app.config.js already feeds to `experiments.baseUrl`.
//
// The spike serves from the root and talks to no doorman, so these are the
// values that describes.

const rawBase = process.env.EXPO_PUBLIC_BASE || '/'

/** `/` served by the Mac, `/selfmp3/` on GitHub Pages. Always ends in a slash. */
export const BASE = rawBase.endsWith('/') ? rawBase : `${rawBase}/`

/** A path of the app's own, under wherever the app lives. */
export function appPath(path) {
  return BASE + path.replace(/^\/+/, '')
}

/** Built for the web with no Mac behind it. Not what the spike is measuring. */
export const CLOUD = process.env.EXPO_PUBLIC_CLOUD === '1'

/** The doorman this build signs in through. Empty when none is set up. */
export const DOORMAN_URL = ''
