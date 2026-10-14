import { prefs } from '../ports/prefs'
import { createValueStore } from '../state/valueStore.model'
import { useValueStore } from '../state/useValueStore'

/**
 * How many seconds one song fades into the next: a preference of this device,
 * as pinyin under the words is (`romanizationPref.ts`).
 *
 * It is the engine in this device that fades, and only a browser's and the
 * desktop app's can (`capabilities.crossfade`): a phone plays gapless and
 * nothing else. So the number is kept where it is used, flips at once, and
 * needs no server — a library's settings are its server's, and a cloud
 * library's server is often away.
 */

const KEY = 'crossfadeSeconds'
export const CROSSFADE_MAX = 12

function read(): number {
  const stored = Number(prefs.get(KEY))
  return Number.isFinite(stored) ? Math.min(Math.max(Math.round(stored), 0), CROSSFADE_MAX) : 0
}

const store = createValueStore(read())

export function setCrossfadeSeconds(seconds: number): void {
  const next = Math.min(Math.max(Math.round(seconds), 0), CROSSFADE_MAX)
  prefs.set(KEY, String(next))
  store.set(next)
}

/** Seconds of overlap between songs on this device; zero is none. */
export function useCrossfadeSeconds(): number {
  return useValueStore(store)
}
