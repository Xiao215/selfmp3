import type { ReactNode, RefObject } from 'react'
import { Pressable, Text, View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import type { Href } from 'expo-router'
import type { Song } from '@selfmp3/shared'
import { isRoomTrackId, radius, type, withAlpha } from '@selfmp3/client'
import { useSongTagLookup } from '../../ui/songTags'
import { Chip } from '../../ui/components/Chip'
import { Plus, TagPlus } from '../../ui/components/Icons'
import { noteTagUsed } from '../library/recentTags.store'
import { RoomSongLine } from '../room/RoomSongLine'
import { tagLink } from '../tag/placeLinks'

/**
 * The song's tags on Now Playing, quietly, on a phone and a computer alike:
 * each chip a door to its tag, and the add chip that opens the tag window.
 *
 * A friend's song in a room is not yours to tag, so where your own song has
 * its tags a room's says who brought it (`RoomSongLine`, mock R5). The phone
 * did that and the stage, built before rooms, did not: it offered "Edit tags"
 * for a song you do not have.
 *
 * Opening a tag counts as using it (`noteTagUsed`), as it does from a list, so
 * the sidebar's recent tags have it.
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
   * The add chip says what it does ("Edit tags") beside its mark, where a
   * mouse has room; on a phone it is the round dashed + the board draws.
   */
  labelled?: boolean
  style?: StyleProp<ViewStyle>
}): ReactNode {
  const { theme } = useUnistyles()
  const tagsOf = useSongTagLookup()
  if (isRoomTrackId(song.id)) return <RoomSongLine song={song} />
  const tags = tagsOf(song)
  const label = tags.length > 0 ? 'Edit tags' : 'Add tags'
  return (
    <View style={[styles.tags, style]}>
      {tags.map(tag => (
        <Chip
          key={tag.id}
          label={tag.name}
          hue={tag.hue}
          selected={false}
          compact
          onPress={() => {
            noteTagUsed(tag.id)
            onOpen(tagLink(tag.name))
          }}
        />
      ))}
      <Pressable
        ref={editRef}
        onPress={onEdit}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: editing }}
        hitSlop={8}
        style={({ pressed }) => [
          labelled ? styles.addLabelled : styles.addRound,
          pressed && styles.addPressed,
        ]}
      >
        {/* The dashed edge is the mark itself: an add chip (`S2`). */}
        {labelled ? (
          <>
            <TagPlus size={14} color={theme.colors.textSecondary} />
            <Text style={styles.addText}>{label}</Text>
          </>
        ) : (
          <Plus size={13} color={theme.colors.textSecondary} />
        )}
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  tags: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  addRound: {
    width: 28,
    height: 28,
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
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.colors.borderStrong,
  },
  addPressed: { backgroundColor: withAlpha(theme.colors.textPrimary, 0.1) },
  addText: { color: theme.colors.textSecondary, fontSize: type.small },
}))
