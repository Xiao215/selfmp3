import { useSyncExternalStore } from 'react'
import type { LyricsLanguage } from '@selfmp3/shared'
import { prefs } from '../../ports/prefs'

/**
 * Whether pinyin or romaji is drawn under the words: two preferences of this
 * device, one per language, since reading one script is no reason to want the
 * other.
 *
 * The romanization itself always travels with the lyrics and is kept with
 * them; this only decides whether the line is shown, which is about the screen
 * in your hand rather than the library. So it lives here, flips at once, and
 * works with no server.
 */

type RomanLanguage = Exclude<LyricsLanguage, 'none'>

const KEYS: Record<RomanLanguage, string> = {
  zh: 'lyricsPinyin',
  ja: 'lyricsRomaji',
}

const current: Partial<Record<RomanLanguage, boolean>> = {}
const listeners = new Set<() => void>()

function read(language: RomanLanguage): boolean {
  current[language] ??= prefs.get(KEYS[language]) === 'on'
  return current[language]
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setRomanizationOn(language: RomanLanguage, on: boolean): void {
  current[language] = on
  prefs.set(KEYS[language], on ? 'on' : 'off')
  for (const listener of listeners) listener()
}

/** Whether this language's romanization is drawn on this device; never for 'none'. */
export function useRomanizationOn(language: LyricsLanguage): boolean {
  const get = (): boolean => (language === 'none' ? false : read(language))
  return useSyncExternalStore(subscribe, get, get)
}
