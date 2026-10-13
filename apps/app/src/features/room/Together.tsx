import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { HIT_TARGET, iconSize, leading, radius, space, type } from '@selfmp3/client'
import { card } from '../../ui/surfaces'
import { tip } from '../../ui/tip'
import { Button } from '../../ui/components/Button'
import { IconButton } from '../../ui/components/IconButton'
import { Press } from '../../ui/components/Press'
import { People } from '../../ui/components/Icons'
import { guideSeen, markGuideSeen, useGuideMemory } from '../guide/guideMemory'
import { RoomFaces } from './RoomFace'
import { peopleHere, roomTitle } from './room.model'
import { openRoomSheet } from './roomSheets.store'
import { useRoom } from './room.store'

/** The most faces drawn where the room shows itself; the room's sheet has everyone. */
const FACES = 3

/**
 * Listening together starts on the player (T1, Xiao 2026-10-13): the phone's
 * Now Playing head and a computer's player bar, beside Devices — where you
 * are when a friend asks what is playing, rather than inside the queue.
 *
 * Out of a room it is People, opening Together (where it plays, or a code to
 * join). In one it is the room's faces, opening the room's sheet.
 */
export function TogetherButton({
  filled = false,
  iconSize: size = iconSize.nav,
  color,
}: {
  /** On the control surface: Now Playing's head. Bare in the player bar. */
  filled?: boolean
  iconSize?: number
  color?: string
}): ReactNode {
  const { theme } = useUnistyles()
  const { state } = useRoom()
  if (!state) {
    return (
      <IconButton
        label="Listen together"
        filled={filled}
        onPress={() => openRoomSheet('together')}
        testID="together"
      >
        <People size={size} color={color ?? theme.colors.textPrimary} />
      </IconButton>
    )
  }
  const people = peopleHere(state)
  return (
    <Press
      feedback="dim"
      onPress={() => openRoomSheet('together')}
      accessibilityRole="button"
      accessibilityLabel={`${roomTitle(state)}, ${people.length} here. Invite, people, end it`}
      {...tip('The room')}
      hitSlop={6}
      testID="together"
      style={styles.faces}
    >
      <RoomFaces people={people.slice(0, FACES)} size={22} />
    </Press>
  )
}

/**
 * The room in the middle of the phone's Now Playing head while you are in
 * one: its faces and its name, opening the room's sheet.
 */
export function RoomPill(): ReactNode {
  const { state } = useRoom()
  if (!state) return null
  const people = peopleHere(state)
  const title = roomTitle(state)
  return (
    <Press
      onPress={() => openRoomSheet('together')}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${people.length} here. Invite, people, end it`}
      testID="together"
      style={({ pressed }) => [styles.pill, pressed && styles.pillPressed]}
    >
      <RoomFaces people={people.slice(0, FACES)} size={22} />
      <Text style={styles.pillText} numberOfLines={1}>
        {title}
      </Text>
    </Press>
  )
}

/**
 * Home's way in (T3), until this device has been in a room or was told Not
 * now: the player's People button is easy to pass by the first time. Kept
 * with the guides, so Settings' Show tips again brings it back and automated
 * runs, which start with every guide seen, never meet it.
 */
export function TogetherCard(): ReactNode {
  const { theme } = useUnistyles()
  useGuideMemory()
  const { state } = useRoom()
  if (state || guideSeen('together-card')) return null
  return (
    <View style={styles.card} testID="home-together">
      <View style={styles.cardMark}>
        <People size={iconSize.nav} color={theme.colors.textPrimary} />
      </View>
      <View style={styles.cardText}>
        <Text style={styles.cardTitle}>Listen together</Text>
        <Text style={styles.cardLine}>Friends add songs to your Up next, from their phones.</Text>
        <View style={styles.cardActions}>
          <Button
            label="Start a room"
            variant="primary"
            onPress={() => openRoomSheet('together')}
            testID="home-together-start"
          />
          <Button
            label="Not now"
            variant="text"
            onPress={() => markGuideSeen('together-card')}
            testID="home-together-dismiss"
          />
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  card: {
    ...card(theme.colors),
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    padding: space.lg,
  },
  cardMark: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface3,
  },
  cardText: { flex: 1, minWidth: 0, gap: 4 },
  cardTitle: { color: theme.colors.textPrimary, fontSize: type.body, fontWeight: '700' },
  cardLine: { color: theme.colors.textSecondary, fontSize: type.sub, lineHeight: leading.sub },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm },
  faces: { minHeight: HIT_TARGET, justifyContent: 'center', paddingHorizontal: 4 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 32,
    maxWidth: '100%',
    paddingLeft: 5,
    paddingRight: space.md,
    borderRadius: radius.pill,
    // The sleep pill's fill, which reads on any song's colour.
    backgroundColor: theme.colors.surface2,
  },
  pillPressed: { backgroundColor: theme.colors.surface3 },
  pillText: {
    flexShrink: 1,
    color: theme.colors.textPrimary,
    fontSize: type.small,
    fontWeight: '600',
  },
}))
