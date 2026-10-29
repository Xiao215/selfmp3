import { useRef } from 'react'
import type { ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { newTagHue, TAG_HUES } from '@selfmp3/shared'
import { radius, tagColors, space } from '@selfmp3/client'
import { Check } from './Icons'
import { hueName } from '../hueNames.model'
import { browserKeys } from '../../ports/browserKeys'

/** A tag's thirteen hues (`TAG_HUES`), the ones a new tag is given too. */
const HUES = TAG_HUES

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
  return { hue, name: hueName(hue), fill: tone.dot, ring: tone.ink, tick: tone.onDot }
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
 * chosen, and choosing another unchooses it. To a keyboard it is one Tab stop,
 * the chosen colour, and the arrows choose the next or the one before, as a
 * radio group's do; Space chooses the one focused.
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
    (first === undefined || HUES.some(hue => hue === first)
      ? HUES.map(tagSwatch)
      : // Named apart from the palette's own colour nearest it, which it
        // would otherwise share a name with: two choices both called "Teal".
        [
          { ...tagSwatch(first), name: `${hueName(first)}, this tag’s own` },
          ...HUES.map(tagSwatch),
        ])
  const nodes = useRef(new Map<number, View | null>())
  // The Tab stop: the chosen colour, or the first when none of these is chosen.
  const stop = swatches.some(swatch => swatch.hue === value) ? value : swatches[0]?.hue
  const keys = browserKeys
    ? {
        onKeyDown: (event: { key: string; target: unknown; preventDefault: () => void }) => {
          const at = swatches.findIndex(swatch => nodes.current.get(swatch.hue) === event.target)
          if (at === -1) return
          if (event.key === ' ') {
            event.preventDefault()
            const here = swatches[at]
            if (here) onChange(here.hue)
            return
          }
          const by =
            event.key === 'ArrowRight' || event.key === 'ArrowDown'
              ? 1
              : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
                ? -1
                : 0
          if (by === 0) return
          event.preventDefault()
          const next = swatches[(at + by + swatches.length) % swatches.length]
          if (!next) return
          onChange(next.hue)
          nodes.current.get(next.hue)?.focus()
        },
      }
    : null
  return (
    <View style={styles.swatches} role="radiogroup" aria-label={label} {...(keys as object)}>
      {swatches.map(swatch => {
        const on = value === swatch.hue
        return (
          <Pressable
            key={swatch.hue}
            ref={node => {
              nodes.current.set(swatch.hue, node)
            }}
            tabIndex={swatch.hue === stop ? 0 : -1}
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
 * The colour a tag of this name is given when none is chosen, among the
 * library's `tags`: the server's own rule (`newTagHue` — the hue farthest from
 * the ones in use, the name deciding between equals), so the first swatch
 * shows what pressing Enter would make.
 */
export function autoTagHue(name: string, tags: readonly { readonly hue: number }[]): number {
  return newTagHue(
    name.trim().replace(/\s+/g, ' '),
    undefined,
    tags.map(tag => tag.hue),
  )
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
