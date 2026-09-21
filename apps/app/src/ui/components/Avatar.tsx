import type { ReactNode } from 'react'
import { Image, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { fonts, radius, tagColors } from '@selfmp3/client'
import type { CloudAccount } from '@selfmp3/shared'

import { accountInitials } from '../../features/profile/profile.model'
import { useAccent } from '../accent'
import { User } from './Icons'

/**
 * Who is signed in, as a round mark: the Google account's picture, the
 * initials of its name when there is no picture, and the plain figure when
 * there is neither — the way every other app does it (Xiao, 2026-09-20).
 *
 * The tile behind it is the accent's, as the tag tiles are, so the initials
 * read on it in any look.
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
  const round = { width: size, height: size, borderRadius: radius.pill }
  return (
    <View style={[styles.avatar, round, { backgroundColor: tile.tile }]}>
      {account?.picture ? (
        <Image source={{ uri: account.picture }} style={round} accessibilityIgnoresInvertColors />
      ) : marks ? (
        <Text style={[styles.initials, { color: tile.tileInk, fontSize: size * 0.42 }]}>
          {marks}
        </Text>
      ) : (
        <User size={Math.round(size * 0.5)} color={tile.tileInk} />
      )}
      {children}
    </View>
  )
}

const styles = StyleSheet.create(() => ({
  avatar: { alignItems: 'center', justifyContent: 'center', overflow: 'visible' },
  initials: { fontFamily: fonts.serif },
}))
