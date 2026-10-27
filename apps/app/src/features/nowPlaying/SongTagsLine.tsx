import { useEffect, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Animated, Text, View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import type { Href } from 'expo-router'
import type { Song } from '@selfmp3/shared'
import { hitSlopFor, isRoomTrackId, radius, type, iconSize, space } from '@selfmp3/client'
import { useSongTagLookup } from '../../ui/songTags'
import { Chip } from '../../ui/components/Chip'
import { Plus, TagPlus } from '../../ui/components/Icons'
import { RoomSongLine } from '../room/RoomSongLine'
import { useOpenTag } from '../tag/useOpenTag'
import { Press } from '../../ui/components/Press'
import { lightTap } from '../../ports/haptics'
import { timing } from '../../ui/motion'
import { backOut, MOVE_MS, OVERSHOOT_S } from '../../ui/motion.model'

/**
 * The song's tags on Now Playing, quietly, on a phone and a computer alike:
 * each chip a door to its tag, and the add chip that opens the tag window.
 *
 * A friend's song in a room is not yours to tag, so where your own song has
 * its tags a room's says who brought it (`RoomSongLine`, mock R5). The phone
 * did that and the stage, built before rooms, did not: it offered "Edit tags"
 * for a song you do not have.
 *
 * Opening a tag counts as using it (`useOpenTag`), as it does everywhere, so
 * the sidebar's recent tags have it.
 *
 * A tag added while the line is in sight snaps in (`SnapIn`, I2 of the Oct 27
 * review): the tags the song had when it came up stand still, and a new one
 * grows into its place past its size and back, with a light tap on a phone.
 */
export function SongTagsLine({
  song,
  onOpen,
  onEdit,
  editing = false,
  editRef,
  labelled = false,
  style,
}: {
  song: Song
  /** Going to a tag's page: the phone's modal puts itself away first (`leaveTo`). */
  onOpen: (href: Href) => void
  /** The add chip: the tag window, up or away. */
  onEdit: () => void
  /** The tag window is up. */
  editing?: boolean
  /** The add chip, for the tag window to hang from on a computer. */
  editRef?: RefObject<View | null>
  /**
   * The add chip says what it does ("Add tag", "Edit tags") beside its mark:
   * Now Playing on a phone and a computer alike, where a lone + said nothing.
   * Left out, it is the round dashed +.
   */
  labelled?: boolean
  style?: StyleProp<ViewStyle>
}): ReactNode {
  const { theme } = useUnistyles()
  const tagsOf = useSongTagLookup()
  const openTag = useOpenTag()
  const tags = tagsOf(song)
  // The tags the song came up with; any other is one added since (`SnapIn`).
  const [had, setHad] = useState(() => ({ songId: song.id, ids: idsOf(tags) }))
  if (had.songId !== song.id) setHad({ songId: song.id, ids: idsOf(tags) })
  if (isRoomTrackId(song.id)) return <RoomSongLine song={song} />
  const label = tags.length > 0 ? 'Edit tags' : 'Add tag'
  return (
    <View style={[styles.tags, style]}>
      {tags.map(tag => (
        <SnapIn key={tag.id} fresh={!had.ids.has(tag.id)}>
          <Chip
            label={tag.name}
            hue={tag.hue}
            selected={false}
            compact
            onPress={() => openTag(tag, { go: onOpen })}
          />
        </SnapIn>
      ))}
      <Press
        feedback="wash"
        ref={editRef}
        onPress={onEdit}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: editing }}
        hitSlop={hitSlopFor(ADD)}
        style={[labelled ? styles.addLabelled : styles.addRound, editing && styles.addOpen]}
      >
        {/* The dashed edge is the mark itself: an add chip (`S2`). */}
        {labelled ? (
          <>
            <TagPlus size={iconSize.field} color={theme.colors.textSecondary} />
            <Text style={styles.addText}>{label}</Text>
          </>
        ) : (
          <Plus size={iconSize.sub} color={theme.colors.textSecondary} />
        )}
      </Press>
    </View>
  )
}

const idsOf = (tags: readonly { id: number }[]): ReadonlySet<number> =>
  new Set(tags.map(tag => tag.id))

/**
 * One chip, still if it was there when the song came up and growing into its
 * place past its size and back if it was added since. Decided once, as it
 * mounts: a tag taken off and put back snaps in again.
 */
function SnapIn({ fresh, children }: { fresh: boolean; children: ReactNode }): ReactNode {
  const [snaps] = useState(fresh)
  const [grow] = useState(() => new Animated.Value(snaps ? 0 : 1))
  useEffect(() => {
    if (!snaps) return
    lightTap()
    timing(grow, 1, MOVE_MS.chipIn, undefined, { easing: backOut(OVERSHOOT_S) })
  }, [snaps, grow])
  const [look] = useState(() => ({
    opacity: grow.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] }),
    transform: [{ scale: grow.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
  }))
  return <Animated.View style={look}>{children}</Animated.View>
}

/** The add chip's side when it is round; the slop brings either shape to a finger's. */
const ADD = 28

const styles = StyleSheet.create(theme => ({
  tags: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.tight },
  addRound: {
    width: ADD,
    height: ADD,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.colors.borderStrong,
  },
  addLabelled: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.tight,
    paddingVertical: 5,
    paddingHorizontal: space.snug,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.colors.borderStrong,
  },
  // While its window is up the chip is filled in, the panel's own tone, so the
  // window reads as having come out of it.
  addOpen: { borderStyle: 'solid', backgroundColor: theme.colors.surface2 },
  addText: { color: theme.colors.textSecondary, fontSize: type.small },
}))
