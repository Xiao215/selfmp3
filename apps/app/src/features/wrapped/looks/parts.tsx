import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { hueFromString } from '@selfmp3/shared'
import { radius, tagColors, withAlpha, type ColorScheme } from '@selfmp3/client'
import type { LookInput } from '../looks.model'
import { monoFont } from '../../../ports/monoFont'

/** What every look is drawn from: the facts, and the two lookups a picture needs. */
export interface LookProps {
  readonly input: LookInput
  /** This device's accent hue: the looks are printed in its inks (`lookInk`). */
  readonly hue: number
  /** A song's cover, as this device can show it; null draws the lettered placeholder. */
  readonly art: (songId: number) => string | null
  /** A tag's hue, from the library; a name the library no longer has is given one. */
  readonly tagHue: (tag: string) => number | undefined
}

/**
 * The receipt's and the front page's type: a till's monospace. The app ships
 * no monospace face, so each platform's own.
 */
export const mono = monoFont

/**
 * A tag on a printed page, as `P33` and `P37` draw it: a pill with a dot of
 * the tag's hue. `fill` is the pill; the dot follows the page's ground, light
 * or dark, the way a chip in the app follows the theme.
 */
export function PrintedTag({
  name,
  hue,
  scheme,
  fill,
  ink,
  size = 13,
  shadow,
}: {
  name: string
  hue: number | undefined
  scheme: ColorScheme
  fill: string
  ink: string
  size?: number
  shadow?: string
}): ReactNode {
  const dot = tagColors(hue ?? hueFromString(name), scheme).dot
  return (
    <View
      style={[
        styles.tag,
        { backgroundColor: fill, height: size + 17 },
        shadow ? { boxShadow: `0 1px 2px ${shadow}` } : null,
      ]}
    >
      <View style={[styles.dot, { backgroundColor: dot }]} />
      <Text style={[styles.tagText, { color: ink, fontSize: size }]} numberOfLines={1}>
        {name}
      </Text>
    </View>
  )
}

/**
 * One cell of a calendar: a dot as big as the day was long, or the cover of
 * the song that owned the day. An empty day is the smallest dot in the page's
 * quiet tone, so the grid still reads as every day of the window.
 */
export function DayDot({
  share,
  cover,
  cell,
  dot,
  empty,
  smallest,
  largest,
  fade,
}: {
  share: number
  cover: ReactNode
  cell: number
  dot: string
  empty: string
  smallest: number
  largest: number
  /** Whether a shorter day is also paler, as `P36`'s are. */
  fade: boolean
}): ReactNode {
  if (cover) return <View style={[styles.center, { width: cell, height: cell }]}>{cover}</View>
  const size = share > 0 ? smallest + share * (largest - smallest) : Math.max(3, smallest * 0.6)
  return (
    <View style={[styles.center, { width: cell, height: cell }]}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: radius.pill,
          backgroundColor: share > 0 ? (fade ? withAlpha(dot, 0.4 + share * 0.45) : dot) : empty,
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 9,
    paddingRight: 11,
    borderRadius: radius.pill,
    maxWidth: 180,
  },
  dot: { width: 7, height: 7, borderRadius: radius.pill },
  tagText: { fontWeight: '600', flexShrink: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
})
