import { useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { plural } from '@selfmp3/shared'
import type { Playlist, Tag } from '@selfmp3/shared'
import { radius, space, type, useStopFollowing, useUpdatePlaylist } from '@selfmp3/client'
import { useAccent } from '../../ui/accent'
import { Chip } from '../../ui/components/Chip'
import { Plus } from '../../ui/components/Icons'
import { ListenTags } from '../../ui/components/ListenTags'
import { card } from '../../ui/surfaces'
import { showToast } from '../../ui/toast'
import { followedTagIds, withFollowedTags } from './follows.model'

/**
 * One line above the songs: the tags this playlist follows.
 *
 * It replaces a panel of seventeen rule fields — text matching, play counts,
 * year, BPM, musical key, loudness — that were a search engine bolted onto a
 * library you browse by feel. In a tag-first app almost nobody opens a playlist
 * to ask about its loudness; they open it for the tags. So the tags are all
 * this takes, and they are shown in the same chips the library head uses, so
 * there is one thing to learn rather than two. A rule the chips cannot draw —
 * a length, a play count — is still followed: a chip edit changes only the
 * tag rules (`withFollowedTags`) and keeps the rest as it was.
 *
 * **Stop filling** keeps every song. That is the whole reason this can be a
 * switch rather than a kind of playlist chosen up front: it is reversible in
 * the direction that matters, and nothing is lost by trying it.
 */
export function FollowsRow({
  playlist,
  tags,
}: {
  playlist: Extract<Playlist, { kind: 'live' }>
  tags: readonly Tag[]
}): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const update = useUpdatePlaylist()
  const stop = useStopFollowing()
  const [choosing, setChoosing] = useState(false)

  const tagIds = followedTagIds(playlist.rules)
  const chosen = tagIds.flatMap(id => tags.filter(tag => tag.id === id))

  const setTags = (next: readonly number[]): void => {
    // The last tag cannot go: a playlist following nothing is empty, which
    // looks exactly like something having gone wrong. Stop following instead.
    if (next.length === 0) return
    update.mutate({ id: playlist.id, patch: { rules: withFollowedTags(playlist.rules, next) } })
  }

  const toggle = (tagId: number): void =>
    setTags(tagIds.includes(tagId) ? tagIds.filter(id => id !== tagId) : [...tagIds, tagId])

  return (
    <View style={styles.row} testID="follows-row">
      <Text style={styles.word}>Fills from</Text>
      {chosen.map(tag => (
        <Chip
          key={tag.id}
          compact
          label={tag.name}
          hue={tag.hue}
          selected
          onPress={() => toggle(tag.id)}
          onRemove={chosen.length > 1 ? () => toggle(tag.id) : undefined}
        />
      ))}
      <View collapsable={false}>
        <Pressable
          onPress={() => setChoosing(open => !open)}
          accessibilityRole="button"
          accessibilityLabel="Add a tag it fills from"
          style={({ pressed }) => [
            styles.add,
            pressed && { backgroundColor: theme.colors.surface2 },
          ]}
          testID="follows-add-tag"
        >
          <Plus size={13} color={theme.colors.textMuted} />
          <Text style={styles.addLabel}>tag</Text>
        </Pressable>
      </View>

      <View style={styles.spacer} />

      <Pressable
        onPress={() => {
          stop.mutate(playlist.id, {
            onSuccess: () =>
              showToast(`“${playlist.name}” keeps its songs and stops adding more`, 'good'),
          })
        }}
        disabled={stop.isPending}
        accessibilityRole="button"
        accessibilityLabel="Stop filling from these tags, keeping every song"
        style={({ pressed }) => [
          styles.stop,
          pressed && { backgroundColor: theme.colors.surface2 },
        ]}
        testID="stop-following"
      >
        <Text style={[styles.stopLabel, stop.isPending && { color: theme.colors.textMuted }]}>
          {stop.isPending ? 'Stopping…' : 'Stop filling'}
        </Text>
      </Pressable>

      {choosing ? (
        <View style={styles.panel}>
          <ListenTags
            open
            onClose={() => setChoosing(false)}
            selected={tagIds}
            onToggle={toggle}
            summary={`${plural(playlist.songCount, 'song', 'songs')}`}
          />
        </View>
      ) : null}
      {update.isError ? (
        <Text style={[styles.stopLabel, { color: accent.accent }]}>Couldn’t save that</Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.xs + 2,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    ...card(theme.colors),
  },
  word: { color: theme.colors.textSecondary, fontSize: type.small },
  spacer: { flex: 1, minWidth: 0 },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.colors.borderStrong,
  },
  addLabel: { color: theme.colors.textMuted, fontSize: type.tiny },
  stop: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill },
  stopLabel: { color: theme.colors.textSecondary, fontSize: type.small },
  panel: { width: '100%' },
}))
