import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { buildAccent, currentColorScheme, DEFAULT_ACCENT_HUE, type Accent } from '@selfmp3/client'

import { prefs } from '../ports/prefs'
import { ACCENT_KEY, readHue, readTheme, THEME_KEY, type ThemeChoice } from './appearancePrefs'
import { applyAccentHue, applyThemeChoice, onSchemeChange } from './theme/unistyles'

export type { ThemeChoice }

/**
 * This phone's accent colour.
 *
 * Deliberately *not* the Mac's `accentHue` setting, and deliberately not
 * synced. Settings that describe the library — what counts as a play, which
 * tags go on an import — are the same everywhere and belong on the server.
 * What colour this screen is belongs to the screen, the same way the volume
 * and which songs are downloaded already do: a phone in a dark pocket and a
 * Mac on a desk are allowed to disagree, and having one overwrite the other
 * would be a worse answer than either.
 *
 * One number, read once at launch and written when it changes, through the
 * `prefs` port — a file on a phone, `localStorage` in a browser. Not the
 * keychain: a hue is nobody's secret.
 */

/** The presets the picker offers, and their hues. The web app offers these. */
export const ACCENT_PRESETS: readonly { hue: number; name: string }[] = [
  { hue: 268, name: 'Violet' },
  { hue: 220, name: 'Blue' },
  { hue: 190, name: 'Teal' },
  { hue: 150, name: 'Green' },
  { hue: 60, name: 'Amber' },
  { hue: 20, name: 'Red' },
  { hue: 330, name: 'Pink' },
]

interface AccentApi extends Accent {
  readonly hue: number
  setHue: (hue: number) => void
  /**
   * The theme this device asked for. Kept with the accent, and for the same
   * reason: how a screen looks belongs to the screen.
   */
  readonly theme: ThemeChoice
  setTheme: (theme: ThemeChoice) => void
}

const AccentContext = createContext<AccentApi | null>(null)

export function AccentProvider({ children }: { children: ReactNode }): ReactNode {
  // Read on the first render rather than in an effect, so the app never shows
  // one colour and then repaints to another a frame later.
  const [hue, setHueState] = useState<number>(() => readHue())

  useEffect(() => {
    // Every themed stylesheet follows the accent, without a reload.
    applyAccentHue(hue)
    // Nothing to write for a default nobody has chosen yet.
    if (hue === DEFAULT_ACCENT_HUE && prefs.get(ACCENT_KEY) === null) return
    prefs.set(ACCENT_KEY, JSON.stringify({ hue }))
  }, [hue])

  const setHue = useCallback((next: number) => {
    setHueState(Math.round(Math.min(359, Math.max(0, next))))
  }, [])

  const [theme, setThemeState] = useState<ThemeChoice>(readTheme)
  const setTheme = useCallback(
    (next: ThemeChoice) => {
      setThemeState(next)
      prefs.set(THEME_KEY, next)
      applyThemeChoice(next, hue)
    },
    [hue],
  )

  // The accent's shades differ between dark and light, and "System" can flip
  // the scheme with nobody touching this provider.
  const [scheme, setScheme] = useState(currentColorScheme)
  useEffect(() => onSchemeChange(setScheme), [])

  const value = useMemo<AccentApi>(
    () => ({ hue, setHue, theme, setTheme, ...buildAccent(hue, scheme) }),
    [hue, setHue, theme, setTheme, scheme],
  )

  return <AccentContext.Provider value={value}>{children}</AccentContext.Provider>
}

/**
 * This device's accent. Falls back to the default outside a provider, so a
 * screen rendered on its own in a test is not obliged to build one.
 */
export function useAccent(): AccentApi {
  const context = useContext(AccentContext)
  return (
    context ?? {
      hue: DEFAULT_ACCENT_HUE,
      setHue: () => undefined,
      theme: 'dark',
      setTheme: () => undefined,
      ...buildAccent(DEFAULT_ACCENT_HUE),
    }
  )
}
