import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { motion, radius, tagColors } from '@selfmp3/client'
import { fonts } from '../../ports/fonts'
import type { CloudAccount } from '@selfmp3/shared'

import { accountInitials } from './avatar.model'
import { useAccent } from '../accent'
import { ease, timing } from '../motion'
import { MOVE_MS } from '../motion.model'
import { User } from './Icons'

/**
 * Who is signed in, as a round mark: the Google account's picture, the
 * initials of its name when there is no picture, and the plain figure when
 * there is neither — the way every other app does it.
 *
 * The tile behind it is the accent's, as the tag tiles are, so the initials
 * read on it in any look.
 *
 * The initials are always drawn and the picture fades in over them once it has
 * decoded (`motion.base`, as a cover does), so a picture that fails to load
 * leaves the letters, with nothing to cut back to. One already to hand is
 * simply there, as a cached cover is (`MOVE_MS.coverQuick`): the avatar is on
 * Home's head and the sidebar, and it fading in on every visit was the
 * picture visibly turning up each time.
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
  // The address that failed, rather than a plain flag: signing in as somebody
  // else gives the new picture its own chance.
  const [failed, setFailed] = useState<string | null>(null)
  const [shown] = useState(() => new Animated.Value(0))
  const fade = useMemo(() => ({ opacity: shown }), [shown])
  // When this address was first drawn, to tell a cached picture from a slow
  // one; a new address starts hidden again, and fades in on its own account.
  const askedAt = useRef(0)
  useLayoutEffect(() => {
    askedAt.current = Date.now()
    shown.setValue(0)
  }, [picture, shown])
  const onLoad = (): void => {
    if (Date.now() - askedAt.current < MOVE_MS.coverQuick) shown.setValue(1)
    else timing(shown, 1, motion.base, undefined, { easing: ease.out })
  }
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
          onLoad={onLoad}
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
