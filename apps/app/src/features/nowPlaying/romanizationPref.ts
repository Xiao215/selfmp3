import { useEffect, useSyncExternalStore } from 'react'
import { useSettings } from '@selfmp3/client'
import { prefs } from '../../ports/prefs'

/**
 * Whether romaji is drawn under the words: a preference of this device.
 *
 * The romaji itself always travels with the lyrics and is kept with them;
 * this only decides whether the line is shown, which is about the screen in
 * your hand rather than the library. So it lives here, flips at once, and
 * works with no server — the synced setting it used to be could not be
 * changed offline, and read as off there, with the romaji sitting unseen in
 * the kept words.
 */

const KEY = 'lyricsRomanization'

let current: boolean | null = null
const listeners = new Set<() => void>()

function read(): boolean {
  if (current === null) current = prefs.get(KEY) === 'on'
  return current
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setRomanizationOn(on: boolean): void {
  current = on
  prefs.set(KEY, on ? 'on' : 'off')
  for (const listener of listeners) listener()
}

/** Whether romaji is drawn on this device. */
export function useRomanizationOn(): boolean {
  return useSyncExternalStore(subscribe, read, read)
}

/**
 * Mounted once, in the shell: a device that has never chosen takes the
 * server's old synced setting as its start, so the switch does not go dark
 * for everyone who had it on. Runs once; after that the device's own choice
 * is the only one.
 */
export function useRomanizationSeed(): void {
  const settings = useSettings()
  const heard = settings.data?.lyricsRomanization
  useEffect(() => {
    if (heard !== undefined && prefs.get(KEY) === null) setRomanizationOn(heard === 'on')
  }, [heard])
}
