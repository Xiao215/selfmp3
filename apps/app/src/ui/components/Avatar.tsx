import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { fonts, motion, radius, tagColors } from '@selfmp3/client'
import type { CloudAccount } from '@selfmp3/shared'

import { accountInitials } from '../../features/profile/profile.model'
import { useAccent } from '../accent'
import { useFade } from '../motion'
import { User } from './Icons'

/**
 * Who is signed in, as a round mark: the Google account's picture, the
 * initials of its name when there is no picture, and the plain figure when
 * there is neither — the way every other app does it (Xiao, 2026-09-20).
 *
 * The tile behind it is the accent's, as the tag tiles are, so the initials
 * read on it in any look.
 *
 * The initials are always drawn and the picture fades in over them once it has
 * decoded (`motion.base`, as a cover does): the picture used to pop in, and a
 * picture that fails to load used to be a hard cut back to the letters. With the
 * letters underneath there is nothing to cut to.
 */
export function Avatar({
  account,
  size,
  children,
}: {
  account: CloudAccount | null
  size: number
  /** The connection dot, for the sidebar's row. */
  children?: ReactNode
}): ReactNode {
  const accent = useAccent()
  const tile = tagColors(accent.hue)
  const marks = accountInitials(account)
  const picture = account?.picture ?? null
  // The address that decoded and the one that failed, rather than plain flags:
  // signing in as somebody else fades the new picture in on its own account.
  const [loaded, setLoaded] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const shown = useFade(picture !== null && loaded === picture, motion.base, motion.base)
  const fade = useMemo(() => ({ opacity: shown }), [shown])
  const round = { width: size, height: size, borderRadius: radius.pill }
  return (
    <View style={[styles.avatar, round, { backgroundColor: tile.tile }]}>
      {marks ? (
        <Text style={[styles.initials, { color: tile.tileInk, fontSize: size * 0.42 }]}>
          {marks}
        </Text>
      ) : (
        <User size={Math.round(size * 0.5)} color={tile.tileInk} />
      )}
      {picture !== null && failed !== picture ? (
        <Animated.Image
          source={{ uri: picture }}
          style={[styles.picture, round, fade]}
          onLoad={() => setLoaded(picture)}
          onError={() => setFailed(picture)}
          accessibilityIgnoresInvertColors
        />
      ) : null}
      {children}
    </View>
  )
}

const styles = StyleSheet.create(() => ({
  avatar: { alignItems: 'center', justifyContent: 'center', overflow: 'visible' },
  // Over the initials, and round on its own account: the tile does not clip, so
  // that the connection dot can sit over its edge.
  picture: { position: 'absolute', top: 0, left: 0 },
  initials: { fontFamily: fonts.serif },
}))
