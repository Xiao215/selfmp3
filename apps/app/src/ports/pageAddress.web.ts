/**
 * See `pageAddress.ts`.
 *
 * A browser tab shows the path: the address bar above it already has the rest.
 * The installed app serves itself from `app://selfmp3` and its window has no
 * address bar, so the whole address is the only way to see which link was
 * wrong — and to tell it apart from a page on the server.
 */
export function shownAddress(path: string): string {
  if (typeof window === 'undefined') return path
  const { protocol, host } = window.location
  return protocol === 'app:' ? `${protocol}//${host}${path}` : path
}
