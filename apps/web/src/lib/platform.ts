import { DEFAULT_DOORMAN_URL } from '@selfmp3/shared'

/**
 * Where this build of the web app lives, and what it talks to.
 *
 * The same code ships two ways. Served by the Mac, it talks to the Mac's
 * `/api`. Built for GitHub Pages (`VITE_CLOUD=1`), there is no Mac behind it:
 * it signs in with Google through the doorman and reads the library from the
 * bucket that belongs to the account (docs/SYNC.md). And on Pages it lives
 * under a path — `/selfmp3/` — rather than at the root, which every absolute
 * URL the app makes has to respect.
 */

/** `/` served by the Mac, `/selfmp3/` on GitHub Pages. Always ends in a slash. */
export const BASE = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`

/** A path of the app's own, under wherever the app lives: `/api/x` → `/selfmp3/api/x`. */
export function appPath(path: string): string {
  return BASE + path.replace(/^\/+/, '')
}

/** Built for the web, with no Mac behind it: the library comes from the bucket. */
export const CLOUD = import.meta.env['VITE_CLOUD'] === '1'

/** The doorman this build signs in through. Empty when none is set up. */
export const DOORMAN_URL = (
  (import.meta.env['VITE_DOORMAN_URL'] as string | undefined) || DEFAULT_DOORMAN_URL
).replace(/\/+$/, '')
