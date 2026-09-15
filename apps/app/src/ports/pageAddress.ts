/**
 * An address in this app as the person would recognise it, for a page that has
 * to say which address it was given: the one that says nothing plays there.
 *
 * On a phone there is no address to see — a link someone followed arrives as
 * its path, and the path is all there is to show.
 */
export function shownAddress(path: string): string {
  return path
}
