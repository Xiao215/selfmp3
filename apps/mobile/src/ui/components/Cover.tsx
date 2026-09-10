import { Image, StyleSheet, Text, View } from 'react-native'
import type { ReactNode } from 'react'
import { hueFromString } from '@selfmp3/shared'
import { colors, radius } from '../theme'

/**
 * Cover art, with the same placeholder the web app uses: a solid colour
 * derived from the title and its first letter. Deriving the hue from the text
 * means a given album always gets the same colour, which turns out to be
 * surprisingly good at making a list scannable.
 */
export function Cover({
  uri,
  title,
  size = 44,
}: {
  uri: string | null
  title: string
  size?: number
}): ReactNode {
  const dimensions = { width: size, height: size, borderRadius: size >= 120 ? radius.lg : radius.sm }

  if (uri) {
    return <Image source={{ uri }} style={[styles.cover, dimensions]} resizeMode="cover" />
  }

  const hue = hueFromString(title)
  return (
    <View style={[styles.cover, dimensions, { backgroundColor: `hsl(${hue}, 28%, 26%)` }]}>
      <Text style={[styles.letter, { fontSize: size * 0.4 }]} numberOfLines={1}>
        {title.trim().charAt(0).toUpperCase() || '?'}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  cover: {
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  letter: {
    color: colors.textSecondary,
    fontWeight: '600',
  },
})
