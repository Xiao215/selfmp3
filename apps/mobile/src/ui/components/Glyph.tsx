import type { ReactNode } from 'react'
import { StyleSheet, Text } from 'react-native'
import { colors } from '../theme'

/**
 * Icons, as text.
 *
 * The web app hand-draws its icons as inline SVG. Doing the same on native
 * would mean adding react-native-svg — a native module and a build step — for
 * a dozen glyphs. The system font already has all of them, they scale with the
 * text size, and they cost nothing.
 */
export const GLYPHS = {
  play: '▶',
  pause: '⏸',
  next: '⏭',
  previous: '⏮',
  shuffle: '⇄',
  repeat: '↻',
  repeatOne: '↺',
  search: '⌕',
  down: '⌄',
  close: '×',
  check: '✓',
  library: '♪',
  playlists: '≣',
  settings: '⚙',
  download: '↓',
  queue: '≡',
} as const

export type GlyphName = keyof typeof GLYPHS

export function Glyph({
  name,
  size = 18,
  color = colors.textPrimary,
}: {
  name: GlyphName
  size?: number
  color?: string
}): ReactNode {
  return <Text style={[styles.glyph, { fontSize: size, color }]}>{GLYPHS[name]}</Text>
}

const styles = StyleSheet.create({
  glyph: {
    textAlign: 'center',
    includeFontPadding: false,
  },
})
