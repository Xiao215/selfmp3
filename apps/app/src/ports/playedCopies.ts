/**
 * The songs a browser's service worker kept for having played them. A phone
 * keeps its played songs as files of its own (`recentCopies.ts`), which count
 * as here already: nothing to add. The browser's is the web twin.
 */

const NONE: ReadonlySet<string> = new Set()

export function playedKeys(): ReadonlySet<string> {
  return NONE
}

export function onPlayedKeys(_listener: () => void): () => void {
  return () => {}
}

export async function refreshPlayed(): Promise<void> {}
