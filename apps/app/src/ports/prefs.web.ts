import type { PrefStore } from './prefs'

export type { PrefStore }

/**
 * The browser's answer: `localStorage`.
 *
 * Wrapped, because `localStorage` does not merely come back empty in a private
 * window or with site data blocked — the accessor itself throws, and an app
 * that cannot remember its colour should still start.
 */
export const prefs: PrefStore = {
  get: key => {
    try {
      return window.localStorage.getItem(`selfmp3.${key}`)
    } catch {
      return null
    }
  },
  set: (key, value) => {
    try {
      window.localStorage.setItem(`selfmp3.${key}`, value)
    } catch {
      // As above: it applies for this run and is forgotten on the next.
    }
  },
}
