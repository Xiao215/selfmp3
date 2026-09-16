import type { MediaRoutes } from '../api/mediaAddress.model'
import { appPath } from './appPath'
import { desktop } from './desktop/bridge'

/**
 * Addresses this platform can have answered from the bucket, for a library
 * that came from there.
 *
 * In a tab these are the app's own `api/stream/<id>` and `api/art/<id>`, under
 * the base the build was made for — the same addresses a server would serve,
 * which is the point. The service worker intercepts them (sw/sw.ts), looks the
 * song's bucket key and the doorman session out of IndexedDB, and fetches the
 * file with the bearer header an `<audio>` element and an `<img>` could never
 * have sent. A player's range goes through as it is, so a song streams rather
 * than having to arrive whole.
 *
 * `rev` rides along as `?v=`. The worker matches the path, so the query is
 * free to name the revision — which is how a replaced cover defeats the cache
 * it is otherwise stored in forever.
 *
 * Null wherever nothing would answer, because an address nobody answers is
 * worse than none: the page would be handed the app's own `index.html` as a
 * song, and "it plays silence" is a much harder bug than "it says it cannot
 * play this".
 *
 *  - **The installed desktop app.** It registers no worker on purpose
 *    (src/ports/serviceWorker.web.ts): `app://selfmp3` is registered without
 *    `allowServiceWorkers`, and the shell keeps songs and covers as files.
 *  - **Development.** No worker is registered there either — it would cache
 *    the dev server's modules and hide every change.
 *  - **A browser without service workers**, such as a tab on plain http.
 */
const answered =
  !desktop && !__DEV__ && typeof navigator !== 'undefined' && 'serviceWorker' in navigator

function withRev(path: string, rev: string | undefined): string {
  return rev ? `${appPath(path)}?v=${encodeURIComponent(rev)}` : appPath(path)
}

export const bucketMedia: MediaRoutes | null = answered
  ? {
      stream: (songId, rev) => withRev(`api/stream/${songId}`, rev),
      /*
       * No `size`: a server resizes a cover and the bucket does not, so asking
       * for one would only split the worker's cache across callers that ask
       * for different sizes of the single picture there is.
       */
      art: (songId, rev) => withRev(`api/art/${songId}`, rev),
    }
  : null
