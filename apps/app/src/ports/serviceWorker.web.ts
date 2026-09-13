import { appPath } from './appPath'

/**
 * The service worker and the web manifest: the web app's `main.tsx`
 * registration, and its `<link rel="manifest">`.
 *
 * The worker (`public/sw.js`, built from `sw/sw.ts`) opens the app offline,
 * serves downloaded songs with range requests, and, signed in to the cloud,
 * fetches a song this browser does not have from the bucket.
 *
 * Production only: in development it would cache the dev server's modules and
 * hide every change until a hard reload. Registering again with a different
 * script (`?cloud=1` after signing in) replaces the worker, which is how it
 * learns there is a bucket.
 *
 * The manifest link is added here rather than in `public/index.html` because
 * the page is served from `/` on the Mac and `/selfmp3/` on Pages, and Expo's
 * template has no placeholder for the base; the manifest's own paths are
 * relative to itself, so it works under either.
 */
export function registerServiceWorker({ cloud }: { cloud: boolean }): void {
  addHeadLink('manifest', appPath('manifest.webmanifest'))
  addHeadLink('apple-touch-icon', appPath('icons/icon-180.png'))

  if (__DEV__ || !('serviceWorker' in navigator)) return
  const script = appPath(cloud ? 'sw.js?cloud=1' : 'sw.js')
  navigator.serviceWorker.register(script, { scope: appPath('') }).catch((error: unknown) => {
    console.warn('service worker registration failed', error)
  })
}

function addHeadLink(rel: string, href: string): void {
  if (document.head.querySelector(`link[rel="${rel}"]`)) return
  const link = document.createElement('link')
  link.rel = rel
  link.href = href
  document.head.appendChild(link)
}
