import { useSyncExternalStore } from 'react'

/**
 * Songs this run of the app has already found no words for.
 *
 * The library remembers a song the lookup called instrumental (`instrumental`
 * on the song), and that song is on its visual from the first frame. But a
 * lookup that simply finds no match — a game soundtrack nobody has published
 * lyrics for — is not remembered anywhere, so every play asked again and sat
 * on the lyrics page for as long as the answer took, then turned into the
 * visual. Asked once here, the answer holds for the rest of the session.
 *
 * Not written to disk: it is a "nobody has published these yet", which may
 * stop being true, and a restart is a cheap way to ask again. "Look for
 * lyrics again" forgets it at once.
 */
const found = new Set<number>()
const listeners = new Set<() => void>()

function changed(): void {
  for (const listener of listeners) listener()
}

export function rememberNoWords(songId: number): void {
  if (found.has(songId)) return
  found.add(songId)
  changed()
}

export function forgetNoWords(songId: number): void {
  if (found.delete(songId)) changed()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useNoWords(songId: number): boolean {
  const read = (): boolean => found.has(songId)
  return useSyncExternalStore(subscribe, read, read)
}
