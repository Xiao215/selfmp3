import { useCallback, useSyncExternalStore } from 'react'
import type { Song } from '@selfmp3/shared'
import { prefs } from '../../ports/prefs'
import {
  autoVisual,
  parseVisualChoices,
  withVisualChoice,
  type VisualChoices,
  type VisualKind,
} from './visuals.model'

/**
 * Which visual a song shows, and the choice someone made for it: a preference
 * of this device, like the romaji switch (`romanizationPref.ts`).
 *
 * The choice is about the screen in your hand, not the library, so it lives
 * here, works with no server and flips at once. One small file of choices by
 * song id; the page and the phone read the same store, so a choice made in a
 * menu shows in the drawing behind it straight away.
 */

const KEY = 'visualChoices'

let current: VisualChoices | null = null
const listeners = new Set<() => void>()

function read(): VisualChoices {
  if (current === null) current = parseVisualChoices(prefs.get(KEY))
  return current
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function choose(songId: number, kind: VisualKind | null): void {
  current = withVisualChoice(read(), songId, kind)
  prefs.set(KEY, JSON.stringify(current))
  for (const listener of listeners) listener()
}

export interface SongVisualChoice {
  /** What is showing. */
  readonly kind: VisualKind
  /** What the song gets from how it sounds, shown beside "Auto". */
  readonly auto: VisualKind
  /** Whether someone chose for this song, rather than the automatic pick. */
  readonly chosen: boolean
  /** `null` goes back to the automatic pick. */
  readonly choose: (kind: VisualKind | null) => void
}

export function useSongVisual(song: Song): SongVisualChoice {
  const songId = song.id
  const readChoice = useCallback(() => read()[String(songId)] ?? null, [songId])
  const choice = useSyncExternalStore(subscribe, readChoice, readChoice)
  const auto = autoVisual(song.audioFeatures)
  const pick = useCallback((kind: VisualKind | null) => choose(songId, kind), [songId])
  return { kind: choice ?? auto, auto, chosen: choice !== null, choose: pick }
}
