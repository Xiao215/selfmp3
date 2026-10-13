import { useState } from 'react'
import type { ReactNode } from 'react'
import { View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { plural } from '@selfmp3/shared'
import type { Playlist, Tag } from '@selfmp3/shared'
import { space, useStopFollowing, useUpdatePlaylist } from '@selfmp3/client'
import { Button } from '../../ui/components/Button'
import { StatusLine } from '../../ui/components/StatusLine'
import { TagChipRow } from '../../ui/components/TagChooser'
import { ListenTags } from '../../ui/components/ListenTags'
import { card } from '../../ui/surfaces'
import { showToast } from '../../ui/toast'
import { tagsWithIds } from '../lists/lists.model'
import { followedTagIds, withFollowedTags } from './follows.model'

/**
 * One line above the songs: the tags this playlist follows.
 *
 * Not a panel of rule fields — text matching, play counts, year, BPM, key,
 * loudness — which would be a search engine bolted onto a library you browse
 * by feel. In a tag-first app almost nobody opens a playlist to ask about its
 * loudness; they open it for the tags. So the tags are all
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
  const update = useUpdatePlaylist()
  const stop = useStopFollowing()
  const [choosing, setChoosing] = useState(false)

  const tagIds = followedTagIds(playlist.rules)
  const chosen = tagsWithIds(tagIds, tags)

  const setTags = (next: readonly number[]): void => {
    // The last tag cannot go: a playlist following nothing is empty, which
    // looks exactly like something having gone wrong. Stop following instead.
    if (next.length === 0) return
    update.mutate({ id: playlist.id, patch: { rules: withFollowedTags(playlist.rules, next) } })
  }

  const toggle = (tagId: number): void =>
    setTags(tagIds.includes(tagId) ? tagIds.filter(id => id !== tagId) : [...tagIds, tagId])

  return (
    <TagChipRow
      lead="Fills from"
      tags={chosen}
      // The last tag stays: following nothing, it would empty (`setTags`).
      onRemove={chosen.length > 1 ? tag => toggle(tag.id) : undefined}
      add={{
        onPress: () => setChoosing(open => !open),
        accessibilityLabel: 'Add a tag it fills from',
        testID: 'follows-add-tag',
      }}
      style={styles.row}
      testID="follows-row"
    >
      <View style={styles.spacer} />

      <Button
        size="small"
        variant="text"
        label={stop.isPending ? 'Stopping…' : 'Stop filling'}
        accessibilityLabel="Stop filling from these tags, keeping every song"
        busy={stop.isPending}
        onPress={() => {
          stop.mutate(playlist.id, {
            onSuccess: () =>
              showToast(`“${playlist.name}” keeps its songs and stops adding more`, 'good'),
          })
        }}
        testID="stop-following"
      />

      {choosing ? (
        <View style={styles.panel}>
          <ListenTags
            open
            onClose={() => setChoosing(false)}
            selected={tagIds}
            onToggle={toggle}
            summary={plural(playlist.songCount, 'song', 'songs')}
          />
        </View>
      ) : null}
      {update.isError ? <StatusLine>Couldn’t save that</StatusLine> : null}
    </TagChipRow>
  )
}

const styles = StyleSheet.create(theme => ({
  row: {
    gap: space.xs + 2,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    ...card(theme.colors),
  },
  spacer: { flex: 1, minWidth: 0 },
  panel: { width: '100%' },
}))
