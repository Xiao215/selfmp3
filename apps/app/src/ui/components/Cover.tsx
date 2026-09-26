import { useMemo, useState } from 'react'
import { Animated, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import type { ReactNode } from 'react'
import { hueFromString } from '@selfmp3/shared'
import { motion, radius } from '@selfmp3/client'
import { useFade } from '../motion'

/**
 * Cover art, with a placeholder: a solid colour derived from the title and
 * its first letter. Deriving the hue from the text
 * means a given album always gets the same colour, which turns out to be
 * surprisingly good at making a list scannable.
 *
 * The placeholder also stands in for art that fails to load — a server that is
 * not running, mostly. Without it, every cover on an offline phone was a
 * blank grey square, which reads as broken rather than as "no picture".
 *
 * The placeholder is always drawn, and the picture fades in over it once it has
 * decoded (`motion.base`): a cover used to pop into place the frame it was
 * ready, and a list scrolled through a hundred of them popping. Because the
 * placeholder is underneath rather than beside it, art that fails needs no
 * fallback of its own — nothing is ever swapped, and nothing is ever blank. A
 * picture already in the cache fires `onLoad` too, so it fades in the same way,
 * within the first frames of the row appearing.
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
  // The address that has decoded, rather than a plain flag: a row handed a new
  // cover fades the new one in instead of showing it at once because the last
  // one had loaded.
  const [loadedUri, setLoadedUri] = useState<string | null>(null)
  const shown = useFade(uri !== null && loadedUri === uri, motion.base, motion.base)
  const fade = useMemo(() => ({ opacity: shown }), [shown])

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

  const hue = hueFromString(title)
  return (
    <View style={[styles.cover, dimensions, { backgroundColor: `hsl(${hue}, 28%, 26%)` }]}>
      <Text style={[styles.letter, { fontSize: size * 0.4 }]} numberOfLines={1}>
        {title.trim().charAt(0).toUpperCase() || '?'}
      </Text>
      {uri && !failed ? (
        <Animated.Image
          source={{ uri }}
          style={[styles.picture, fade]}
          resizeMode="cover"
          onLoad={() => setLoadedUri(uri)}
          onError={() => setFailedUri(uri)}
          accessibilityIgnoresInvertColors
        />
      ) : null}
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
  // Over the letter, filling the tile, so the corners are the tile's own.
  picture: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  letter: {
    color: theme.colors.textSecondary,
    fontWeight: '600',
  },
}))
