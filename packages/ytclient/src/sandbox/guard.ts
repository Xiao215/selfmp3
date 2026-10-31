import { YT_PROXY_PAGES } from '@selfmp3/shared'

/*
 * The sandbox frame runs YouTube's code, and whatever answers its requests
 * chooses that code. It is meant to run only where the app puts it: an
 * iframe with `sandbox="allow-scripts"` and nothing else, made by the app's
 * own page.
 *
 * The same page is published with the web app, though, and any site can
 * frame it. Framed plainly it would have the app's origin, and its storage;
 * framed in a sandbox of that site's own, the site would be the one choosing
 * what it runs. So before storage.ts or youtubei.js runs a line, it looks,
 * and anywhere else stops here with nothing after it run:
 *
 * - its origin must be opaque (`'null'`): sandboxed, not the app's;
 * - the page that framed it must be the app's (`YT_PROXY_PAGES`), as the
 *   browser says it (`location.ancestorOrigins`).
 *
 * The extension makes its own check of the same kind (an opaque origin is
 * turned away, background/ytProxy.ts), so this is not the only lock.
 */
const appOrigins = new Set(YT_PROXY_PAGES.map(page => new URL(page).origin))
const framedBy = location.ancestorOrigins[0]
if (self.origin !== 'null' || framedBy === undefined || !appOrigins.has(framedBy)) {
  throw new Error('the YouTube sandbox runs only in the frame the app makes for it')
}

export {}
