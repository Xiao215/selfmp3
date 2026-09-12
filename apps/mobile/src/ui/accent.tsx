import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { File, Paths } from 'expo-file-system'
import { buildAccent, DEFAULT_ACCENT_HUE, type Accent } from '@selfmp3/client'

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
 * One number in one small file, read once at launch and written when it
 * changes. Not the keychain — a hue is nobody's secret.
 */

const PREFS_FILE_NAME = 'accent.json'

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
}

const AccentContext = createContext<AccentApi | null>(null)

function prefsFile(): File {
  return new File(Paths.document, PREFS_FILE_NAME)
}

function readHue(): number {
  try {
    const file = prefsFile()
    if (!file.exists) return DEFAULT_ACCENT_HUE
    const parsed: unknown = JSON.parse(file.textSync())
    const hue =
      typeof parsed === 'object' && parsed !== null ? (parsed as { hue?: unknown }).hue : undefined
    // Anything else — a file from a newer build, a half-written one — is just
    // the default. There is nothing here worth failing to start over.
    return typeof hue === 'number' && Number.isFinite(hue) && hue >= 0 && hue < 360
      ? Math.round(hue)
      : DEFAULT_ACCENT_HUE
  } catch {
    return DEFAULT_ACCENT_HUE
  }
}

export function AccentProvider({ children }: { children: ReactNode }): ReactNode {
  // Read on the first render rather than in an effect, so the app never shows
  // one colour and then repaints to another a frame later.
  const [hue, setHueState] = useState<number>(() => readHue())

  useEffect(() => {
    if (hue === DEFAULT_ACCENT_HUE && !prefsFile().exists) return
    try {
      prefsFile().write(JSON.stringify({ hue }))
    } catch {
      // A colour that cannot be saved still applies for this run.
    }
  }, [hue])

  const setHue = useCallback((next: number) => {
    setHueState(Math.round(Math.min(359, Math.max(0, next))))
  }, [])

  const value = useMemo<AccentApi>(() => ({ hue, setHue, ...buildAccent(hue) }), [hue, setHue])

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
      ...buildAccent(DEFAULT_ACCENT_HUE),
    }
  )
}
