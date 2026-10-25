import type { ReactNode } from 'react'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { HIT_TARGET, hitSlopFor, iconSize, radius } from '@selfmp3/client'
import { useLayoutValue } from '../../shell/useLayout'
import { tip } from '../../ui/tip'
import { HeadPill } from '../../ui/components/HeadPill'
import { IconButton } from '../../ui/components/IconButton'
import { Press } from '../../ui/components/Press'
import { People } from '../../ui/components/Icons'
import { RoomFaces } from './RoomFace'
import { LiveRing } from './roomMotion'
import { peopleHere, roomTitle } from './room.model'
import { openRoomSheet, type RoomStart } from './roomSheets.store'
import { useRoom } from './room.store'

/** The most faces drawn where the room shows itself; the room's sheet has everyone. */
const FACES = 3

/** The most faces inside the room button. */
const INSIDE = 2

const PLAYING: RoomStart = { kind: 'playing' }
const EMPTY: RoomStart = { kind: 'empty' }

/**
 * Listening together starts on the player (T1, Xiao 2026-10-13): the phone's
 * Now Playing head and a computer's player bar, beside Devices — where you
 * are when a friend asks what is playing, rather than inside the queue.
 *
 * Out of a room it is People, opening Together. In one (L1, Xiao 2026-10-14)
 * it is the same round with the accent's edge and a ring pulsing out from
 * it: the faces of whoever else is here inside, or People while you are
 * alone, opening the room's sheet.
 */
export function TogetherButton({
  filled = false,
  iconSize: size = iconSize.nav,
  color,
  start = PLAYING,
}: {
  /** On the control surface: Now Playing's head. Bare in the player bar. */
  filled?: boolean
  iconSize?: number
  color?: string
  /**
   * What a room opened from here starts with: the song playing, from the
   * player; nothing, from Home's header (A1), where you add songs after.
   */
  start?: RoomStart
}): ReactNode {
  const { theme } = useUnistyles()
  const { state } = useRoom()
  const dense = useLayoutValue(layout => layout.dense)
  if (!state) {
    return (
      <IconButton
        label="Listen together"
        filled={filled}
        onPress={() => openRoomSheet(start)}
        testID="together"
      >
        <People size={size} color={color ?? theme.colors.textPrimary} />
      </IconButton>
    )
  }
  const people = peopleHere(state)
  // Everyone but you: your own face is beside it already, as your profile's.
  const others = people.filter(person => person.id !== state.you).slice(0, INSIDE)
  const round = dense ? (filled ? 36 : 34) : filled ? 40 : HIT_TARGET
  return (
    <Press
      depth="control"
      wrap={{ width: round, height: round }}
      onPress={() => openRoomSheet()}
      accessibilityRole="button"
      accessibilityLabel={`${roomTitle(state)}, ${people.length} here. Invite, people, end it`}
      {...tip('The room')}
      hitSlop={hitSlopFor(round)}
      testID="together"
      style={[styles.live, { width: round, height: round }]}
    >
      <LiveRing style={styles.liveRing} />
      {others.length === 0 ? (
        <People size={size} color={theme.colors.accent} />
      ) : others.length === 1 ? (
        <RoomFaces people={others} size={round - 8} ring={false} />
      ) : (
        <RoomFaces people={others} size={Math.round(round * 0.58)} ring />
      )}
    </Press>
  )
}

/**
 * The room in the middle of the phone's Now Playing head while you are in
 * one: its faces and its name — Reconnecting… while the line is down —
 * opening the room's sheet.
 */
export function RoomPill(): ReactNode {
  const { state, link } = useRoom()
  if (!state) return null
  const people = peopleHere(state)
  const title = roomTitle(state)
  return (
    <HeadPill
      lead={<RoomFaces people={people.slice(0, FACES)} size={22} />}
      faces
      text={link === 'live' ? title : 'Reconnecting…'}
      label={`${title}, ${people.length} here. Invite, people, end it`}
      onPress={() => openRoomSheet()}
      testID="together"
    />
  )
}

/**
 * Home's header's way in (A1, Xiao 2026-10-14): always there, beside Import,
 * so a room needs nothing playing first. It opens empty — songs are added, or
 * asked for, once it is open. In a room it is the room's faces.
 */
export function HomeTogetherButton(): ReactNode {
  return <TogetherButton filled start={EMPTY} />
}

const styles = StyleSheet.create(theme => ({
  live: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.surface2,
  },
  liveRing: {
    position: 'absolute',
    top: -2,
    left: -2,
    right: -2,
    bottom: -2,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: theme.colors.accent,
  },
}))
