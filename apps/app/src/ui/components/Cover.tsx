import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Animated, Image, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import type { ReactNode } from 'react'
import { hueFromString } from '@selfmp3/shared'
import { motion, radius, tagColors } from '@selfmp3/client'
import { ease, timing } from '../motion'

/**
 * How soon a picture has to arrive to be simply there rather than fade in: one
 * already in the cache answers within a frame or two, and fading that in over
 * the empty tile was a cover visibly turning up every time a row did.
 */
const QUICK_MS = 120

/**
 * Cover art, and what stands in for it.
 *
 * Three ways it can be. A picture, once it has decoded. A quiet tile in the
 * surface's own colour while one is coming — an address still loading, or a
 * cover this device is still fetching (`useArt` says `undefined`). And a
 * letter tile — a solid colour from the title and its first letter — for a
 * song with no picture, or one whose picture failed: a server that is not
 * running, mostly. Without the letter every cover on an offline phone was a
 * blank grey square, which reads as broken rather than as "no picture".
 *
 * The letter used to be drawn under every cover, always, with the picture
 * fading in over it: every cover that was still on its way showed a letter
 * first and then swapped it for the picture, which Xiao saw as the app showing
 * the wrong cover for half a second (2026-10-07). The letter now means only
 * "there is no picture", and a picture already to hand is shown at once; one
 * that takes longer fades in over the quiet tile (`motion.base`), so a list
 * scrolled through a hundred of them does not pop.
 *
 * A new address for the same tile — a server's cover kept on the device and
 * drawn from the file after that — keeps the picture it had under the new one
 * until the new one has drawn, rather than going back to empty in between.
 */
export function Cover({
  uri,
  title,
  size = 44,
  radius: cornerRadius,
}: {
  /** The picture; null for none to show, undefined for one on its way (`offline/useArt.ts`). */
  uri: string | null | undefined
  title: string
  size?: number
  /** The corners, when the size's own choice is wrong: 0 inside a mosaic. */
  radius?: number
}): ReactNode {
  // The address that failed, so a new one gets its own chance: the server may be back.
  const [failedUri, setFailedUri] = useState<string | null>(null)
  const failed = !!uri && failedUri === uri
  // The address that last decoded. While it is not this one, it is the picture
  // left under the one loading.
  const [loadedUri, setLoadedUri] = useState<string | null>(null)
  const under = uri && loadedUri && loadedUri !== uri && loadedUri !== failedUri ? loadedUri : null
  const [shown] = useState(() => new Animated.Value(0))
  // When this address was first drawn, to tell a cached picture from a slow one.
  const askedAt = useRef(0)
  useLayoutEffect(() => {
    askedAt.current = Date.now()
    if (uri && loadedUri === uri) return
    shown.setValue(0)
    // Only a new address can make the picture loaded or not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri, shown])

  const onLoad = (): void => {
    if (!uri) return
    // At once when it was already to hand, or when the last picture is under it.
    if (under || Date.now() - askedAt.current < QUICK_MS) shown.setValue(1)
    else timing(shown, 1, motion.base, undefined, { easing: ease.out })
    setLoadedUri(uri)
  }

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

  const lettered = uri === null || failed
  // The letter tile is a tag's tile in the title's hue — deep with light ink
  // in the dark, a pale tint with dark ink on Paper — so a song with no
  // picture sits among the tag tiles as one of them, and its row's tint
  // (`tileTone`) is worked out from the same colour.
  const tile = lettered ? tagColors(hueFromString(title)) : null
  return (
    <View style={[styles.cover, dimensions, tile && { backgroundColor: tile.tile }]}>
      {tile ? (
        <Text
          style={[styles.letter, { color: tile.tileInk, fontSize: size * 0.4 }]}
          numberOfLines={1}
        >
          {title.trim().charAt(0).toUpperCase() || '?'}
        </Text>
      ) : null}
      {under ? (
        <Image
          source={{ uri: under }}
          style={styles.picture}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
        />
      ) : null}
      {uri && !failed ? (
        <Animated.Image
          source={{ uri }}
          style={[styles.picture, { opacity: shown }]}
          resizeMode="cover"
          onLoad={onLoad}
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
  letter: { fontWeight: '600' },
}))
