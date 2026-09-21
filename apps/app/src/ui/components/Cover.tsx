import { useMemo, useState } from 'react'
import { Image, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import type { ReactNode } from 'react'
import { hueFromString } from '@selfmp3/shared'
import { radius } from '@selfmp3/client'

/**
 * Cover art, with a placeholder: a solid colour derived from the title and
 * its first letter. Deriving the hue from the text
 * means a given album always gets the same colour, which turns out to be
 * surprisingly good at making a list scannable.
 *
 * The placeholder also stands in for art that fails to load — a server that is
 * not running, mostly. Without it, every cover on an offline phone was a
 * blank grey square, which reads as broken rather than as "no picture".
 */
export function Cover({
  uri,
  title,
  size = 44,
  radius: cornerRadius,
}: {
  uri: string | null
  title: string
  size?: number
  /** The corners, when the size's own choice is wrong: 0 inside a mosaic. */
  radius?: number
}): ReactNode {
  // The address that failed, so a new one gets its own chance: the server may be back.
  const [failedUri, setFailedUri] = useState<string | null>(null)
  const failed = uri !== null && failedUri === uri

  // Held, rather than a new object on every render of every cover in a list:
  // for a given call site these three numbers never change.
  const dimensions = useMemo(
    () => ({
      width: size,
      height: size,
      // `S2`: a big cover is a card, a row's cover 10, a small one 8.
      borderRadius:
        cornerRadius ?? (size >= 120 ? radius.card : size >= 40 ? radius.cover : radius.coverSm),
    }),
    [size, cornerRadius],
  )

  if (uri && !failed) {
    return (
      <Image
        source={{ uri }}
        style={[styles.cover, dimensions]}
        resizeMode="cover"
        onError={() => setFailedUri(uri)}
      />
    )
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

const styles = StyleSheet.create(theme => ({
  cover: {
    backgroundColor: theme.colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  letter: {
    color: theme.colors.textSecondary,
    fontWeight: '600',
  },
}))
