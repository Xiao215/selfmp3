/**
 * Which files of a web export the service worker keeps at install, as paths
 * relative to the export's root.
 *
 * The page's own build output: the JavaScript (`_expo/`), the fonts and
 * pictures it loads (`assets/`), and the icons. Not the plain pages published
 * beside the app or their fonts (`fonts/`), not `404.html` (a copy of the
 * index the worker keeps under its own name), and not the worker itself.
 *
 * Kept at install, not on first use: the page a first visit loads is not the
 * worker's yet, and after a deploy the new bundle is fetched through the old
 * worker into the old build's cache, which the new one sweeps away — either
 * way the next offline open was a blank page (sw/sw.ts, `install`).
 *
 * Pure, so what is kept can be tested without an export.
 */
export function shellFiles(paths) {
  return paths
    .map(path => path.split('\\').join('/'))
    .filter(
      path =>
        path.startsWith('_expo/') ||
        path.startsWith('assets/') ||
        path.startsWith('icons/') ||
        path === 'favicon.ico',
    )
    .filter(path => !path.endsWith('.map') && !path.split('/').pop().startsWith('.'))
    .sort()
}
