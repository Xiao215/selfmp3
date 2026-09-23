import type { ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { hueFromString } from '@selfmp3/shared'
import { oklchToHexAlpha } from '@selfmp3/client'
import { Check } from './Icons'

/**
 * Twelve hues around the wheel, skipping the muddy stretch between yellow and
 * green where chips stop looking like different colours from each other.
 */
const HUES = [0, 22, 40, 58, 95, 140, 168, 192, 212, 235, 262, 290, 318] as const

/**
 * A row of colours to pick a tag's hue from: the editor's, and the new-tag
 * forms', so a tag is coloured the same way wherever it is made or changed.
 *
 * `first` is a hue that leads the row when the palette does not hold it — the
 * colour a tag already has, or the one a new name would be given — so what a
 * tag is about to look like is always one of the choices.
 */
export function HueSwatches({
  value,
  first,
  onChange,
  size = 26,
}: {
  value: number
  first?: number
  onChange: (hue: number) => void
  /** The swatch's diameter; the sidebar's form has less room than a card. */
  size?: number
}): ReactNode {
  const hues: readonly number[] =
    first === undefined || HUES.some(hue => hue === first) ? HUES : [first, ...HUES]
  return (
    <View style={styles.swatches} role="radiogroup" aria-label="Tag colour">
      {hues.map(hue => {
        const on = value === hue
        return (
          <Pressable
            key={hue}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={`Hue ${hue}`}
            onPress={() => onChange(hue)}
            style={[styles.swatchRing, on && { borderColor: oklchToHexAlpha(0.75, 0.14, hue, 1) }]}
          >
            <View
              style={[
                styles.swatch,
                {
                  width: size,
                  height: size,
                  borderRadius: size / 2,
                  backgroundColor: oklchToHexAlpha(0.62, 0.15, hue, 1),
                },
              ]}
            >
              {on ? (
                <Check size={size < 24 ? 10 : 12} color={oklchToHexAlpha(0.18, 0.03, hue, 1)} />
              ) : null}
            </View>
          </Pressable>
        )
      })}
    </View>
  )
}

/**
 * The colour a tag of this name is given when none is chosen: the server's
 * own rule (`hueFromString` of the normalised name), so the first swatch shows
 * what pressing Enter would make.
 */
export function autoTagHue(name: string): number {
  return hueFromString(name.trim().replace(/\s+/g, ' ').toLowerCase())
}

const styles = StyleSheet.create(() => ({
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  // The ring is the mark of the chosen colour, so it keeps its edge.
  swatchRing: {
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: 999,
    padding: 2,
  },
  swatch: { alignItems: 'center', justifyContent: 'center' },
}))
