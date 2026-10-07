import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { ReactNode } from 'react'
import { buildAccent, currentColorScheme, DEFAULT_ACCENT_HUE, type Accent } from '@selfmp3/client'

import { setAppIconHue } from '../ports/appIcon'
import { prefs } from '../ports/prefs'
import { ACCENT_KEY, readHue, readTheme, THEME_KEY, type ThemeChoice } from './appearancePrefs'
import { applyAccentHue, applyThemeChoice, useShownScheme } from './theme/unistyles'

/**
 * This device's accent colour.
 *
 * Deliberately not a server setting, and deliberately not synced. Settings that describe the library — what counts as a play, which
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

/** How long the hue has to sit still before it is written down, in ms. */
const SETTLE_MS = 200

/** The presets the picker offers, and their hues. */
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

  // Every themed stylesheet follows the accent, without a reload. The only
  // half of a hue change that has to keep up with a finger on the picker.
  useEffect(() => {
    applyAccentHue(hue)
  }, [hue])

  // The half that can wait, held until the hue stops moving. Redrawing the
  // tab's 音符 hands the browser an SVG to decode, and writing the preference
  // is a synchronous write — a file, on a phone. A drag asks for a new hue on
  // every frame; only the one it comes to rest on is worth either, so each
  // change cancels the save the one before it scheduled.
  useEffect(() => {
    const timer = setTimeout(() => {
      setAppIconHue(hue)
      // Nothing to write for a default nobody has chosen yet.
      if (hue === DEFAULT_ACCENT_HUE && prefs.get(ACCENT_KEY) === null) return
      prefs.set(ACCENT_KEY, JSON.stringify({ hue }))
    }, SETTLE_MS)
    return () => clearTimeout(timer)
  }, [hue])

  /*
   * A pointer reports itself more often than the screen is drawn, and every
   * move that reaches React is a render of each of the fifty-odd screens and
   * controls the accent reaches. Only the last hue in a frame is a colour
   * anybody sees, so the ones before it are dropped rather than rendered.
   */
  const frame = useRef<number | null>(null)
  const latest = useRef(hue)
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    },
    [],
  )

  const setHue = useCallback((next: number) => {
    latest.current = Math.round(Math.min(359, Math.max(0, next)))
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      setHueState(latest.current)
    })
  }, [])

  const [theme, setThemeState] = useState<ThemeChoice>(readTheme)
  const setTheme = useCallback((next: ThemeChoice) => {
    setThemeState(next)
    prefs.set(THEME_KEY, next)
    applyThemeChoice(next)
  }, [])

  // The accent's shades differ between dark and light, and "System" can flip
  // the scheme with nobody touching this provider.
  const scheme = useShownScheme()

  const value = useMemo<AccentApi>(
    () => ({ hue, setHue, theme, setTheme, ...buildAccent(hue, scheme) }),
    [hue, setHue, theme, setTheme, scheme],
  )

  // The accent colour for the few that read it outside this context, so that
  // only they hear a change (`useAccentColor`).
  useLayoutEffect(() => publishAccentColor(value.accent), [value.accent])

  return <AccentContext.Provider value={value}>{children}</AccentContext.Provider>
}

/*
 * The accent colour, outside React's context. Everything that reads the
 * context re-renders on every frame of a drag on the accent picker, which is
 * right for a screen's few controls and wrong for a list: every song row asks
 * for its playing colour, and only one of them is playing. `useAccentColor`
 * reads this instead, and a row that is not asking does not hear it change.
 */
let accentColor: string | null = null
const accentListeners = new Set<() => void>()

function publishAccentColor(next: string): void {
  if (next === accentColor) return
  accentColor = next
  for (const listener of accentListeners) listener()
}

function subscribeAccent(listener: () => void): () => void {
  accentListeners.add(listener)
  return () => accentListeners.delete(listener)
}

/** Before the provider has published one: the hue it is about to start from. */
function readAccentColor(): string {
  accentColor ??= buildAccent(readHue(), currentColorScheme()).accent
  return accentColor
}

/**
 * The accent colour, or `fallback` while `wanted` is false — and while it is
 * false, no re-render when the accent changes. For a component of which there
 * are hundreds and which needs the accent only now and then: a song row needs
 * it only while it is the playing one.
 */
export function useAccentColor(wanted = true, fallback = ''): string {
  const read = useCallback(() => (wanted ? readAccentColor() : fallback), [wanted, fallback])
  return useSyncExternalStore(subscribeAccent, read, read)
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
