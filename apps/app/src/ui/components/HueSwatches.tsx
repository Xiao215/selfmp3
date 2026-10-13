import type { ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { hueFromString } from '@selfmp3/shared'
import { radius, tagColors, space } from '@selfmp3/client'
import { Check } from './Icons'

/**
 * Thirteen hues around the wheel, skipping the muddy stretch between yellow and
 * green where chips stop looking like different colours from each other.
 */
const HUES = [0, 22, 40, 58, 95, 140, 168, 192, 212, 235, 262, 290, 318] as const

/** One colour on offer: its hue, its name, and how it is drawn. */
interface Swatch {
  readonly hue: number
  readonly name: string
  /** The swatch's fill. */
  readonly fill: string
  /** The ring round the chosen one. */
  readonly ring: string
  /** The tick on the chosen one. */
  readonly tick: string
}

/** A tag's colour as a swatch: the dot every chip and row draws, ringed in its ink. */
function tagSwatch(hue: number): Swatch {
  const tone = tagColors(hue)
  return { hue, name: `Hue ${hue}`, fill: tone.dot, ring: tone.ink, tick: tone.onDot }
}

/**
 * A row of colours to pick one from: a tag's, in the editor and the new-tag
 * forms, so a tag is coloured the same way wherever it is made or changed; and
 * the app's accent, in Settings, which had its own row of circles at another
 * size that said it was a row of buttons.
 *
 * With no `options` it is a tag's thirteen hues, each drawn as the tag would
 * be (`tagColors`); `first` is a hue that leads the row when the palette does
 * not hold it — the colour a tag already has, or the one a new name would be
 * given — so what a tag is about to look like is always one of the choices.
 * `options` is any other set, each with its own fill, ring and tick.
 *
 * A radio group to assistive technology, named by `label`: one colour is
 * chosen, and choosing another unchooses it.
 */
export function HueSwatches({
  value,
  first,
  options,
  label = 'Tag colour',
  onChange,
  size = 26,
}: {
  value: number
  first?: number
  options?: readonly Swatch[]
  label?: string
  onChange: (hue: number) => void
  /** The swatch's diameter; the sidebar's form has less room than a card. */
  size?: number
}): ReactNode {
  const swatches: readonly Swatch[] =
    options ??
    (first === undefined || HUES.some(hue => hue === first) ? HUES : [first, ...HUES]).map(
      tagSwatch,
    )
  return (
    <View style={styles.swatches} role="radiogroup" aria-label={label}>
      {swatches.map(swatch => {
        const on = value === swatch.hue
        return (
          <Pressable
            key={swatch.hue}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            // react-native-web turns `accessibilityState` into nothing a browser reads.
            aria-checked={on}
            accessibilityLabel={swatch.name}
            onPress={() => onChange(swatch.hue)}
            style={[styles.swatchRing, on && { borderColor: swatch.ring }]}
          >
            <View
              style={[
                styles.swatch,
                {
                  width: size,
                  height: size,
                  borderRadius: size / 2,
                  backgroundColor: swatch.fill,
                },
              ]}
            >
              {on ? <Check size={size < 24 ? 10 : 12} color={swatch.tick} /> : null}
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
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: space.tight },
  // The ring is the mark of the chosen colour, so it keeps its edge.
  swatchRing: {
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: radius.pill,
    padding: 2,
  },
  swatch: { alignItems: 'center', justifyContent: 'center' },
}))
