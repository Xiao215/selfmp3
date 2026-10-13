import { useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import type { Song } from '@selfmp3/shared'
import { failureText, space, type, useAddToPlaylist, useBulkTag } from '@selfmp3/client'
import { Button } from '../../ui/components/Button'
import { LibrarySongPicker } from '../../ui/components/LibrarySongPicker'
import { Sheet } from '../../ui/components/Sheet'

/**
 * Who the picked songs go to: a playlist that exists, which takes each song
 * as it is pressed, or one being made, which does not exist until its first
 * songs are confirmed and is made with them by `create`.
 */
type AddSongsTarget =
  | { kind: 'existing'; playlistId: number; inPlaylist: ReadonlySet<number> }
  | { kind: 'new'; create: (songIds: readonly number[]) => Promise<void> }
  /**
   * A tag's page: "adding a song" there is tagging it (docs/features/lists.md).
   * Each + tags at once; pressing Tagged again takes the tag back off.
   */
  | { kind: 'tag'; tagId: number; inTag: ReadonlySet<number> }

const NOTHING: ReadonlySet<number> = new Set()

/**
 * Filling a playlist without leaving it, or filling a new one before it exists.
 *
 * Search the library and press + on as many songs as you like. For a playlist
 * that exists each is added as it is pressed and the window stays open; songs
 * already in it say so instead of offering a second copy. For a new one the
 * songs are only picked — pressing Added again puts one back — and the
 * playlist is made with them when Make playlist is pressed, so closing the
 * window leaves nothing behind (docs/UI-MIGRATION.md, Phase 5: a playlist
 * exists once it has a song). With nothing typed it shows the newest songs
 * first, which is usually what was just imported to add.
 *
 * On a tag's page the same window tags songs: each + puts the tag on the
 * song, and Tagged pressed again takes it off, so a slip costs one press.
 */
export function AddSongsSheet({
  open,
  onClose,
  targetName,
  target,
}: {
  open: boolean
  onClose: () => void
  /** What the songs go to: the playlist's name (one being made, too), or the tag's. */
  targetName: string
  target: AddSongsTarget
}): ReactNode {
  const addToPlaylist = useAddToPlaylist()
  const bulkTag = useBulkTag()
  const [added, setAdded] = useState<ReadonlySet<number>>(new Set())
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const making = target.kind === 'new'
  const tagging = target.kind === 'tag'
  const inPlaylist =
    target.kind === 'existing' ? target.inPlaylist : target.kind === 'tag' ? target.inTag : NOTHING

  const close = (): void => {
    onClose()
    setAdded(new Set())
    setError(null)
  }

  const add = (song: Song): void => {
    if (target.kind === 'existing') {
      addToPlaylist.mutate({ playlistId: target.playlistId, songIds: [song.id] })
    }
    if (target.kind === 'tag') {
      bulkTag.mutate({ songIds: [song.id], tagId: target.tagId, action: 'add' })
    }
    setAdded(current => new Set(current).add(song.id))
  }

  /**
   * While making one nothing has been sent, so a pick can be taken back; on a
   * tag's page the tag comes off again.
   */
  const unpick = (song: Song): void => {
    if (target.kind === 'tag') {
      bulkTag.mutate({ songIds: [song.id], tagId: target.tagId, action: 'remove' })
    }
    setAdded(current => {
      const next = new Set(current)
      next.delete(song.id)
      return next
    })
  }

  const create = async (): Promise<void> => {
    if (target.kind !== 'new' || added.size === 0 || creating) return
    setCreating(true)
    setError(null)
    try {
      // In the order they were picked, which is the order a person means.
      await target.create([...added])
      setAdded(new Set())
    } catch (caught) {
      // The picks stay, so trying again is one press.
      setError(failureText(`Couldn’t make “${targetName}”`, caught))
    } finally {
      setCreating(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      title={tagging ? `Tag songs “${targetName}”` : `Add to ${targetName}`}
      width={480}
      testID="add-songs"
    >
      <View style={styles.body}>
        <LibrarySongPicker
          autoFocus
          stateOf={song => (added.has(song.id) ? 'added' : inPlaylist.has(song.id) ? 'has' : 'add')}
          onAdd={add}
          onUnpick={making || tagging ? unpick : undefined}
          labels={{
            added: tagging ? 'Tagged' : 'Added',
            has: tagging ? 'Has it' : 'In this list',
            add: song => (tagging ? `Tag ${song.title}` : `Add ${song.title}`),
            unpick: song =>
              tagging ? `Take the tag off ${song.title}` : `Take ${song.title} back out`,
          }}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.foot}>
          <Text style={styles.hint}>
            {added.size > 0
              ? `${added.size} ${tagging ? 'tagged' : 'added'}`
              : making
                ? 'Pick its first songs'
                : ' '}
          </Text>
          {making ? (
            <View style={styles.footActions}>
              <Button label="Cancel" onPress={close} />
              <Button
                label="Make playlist"
                variant="primary"
                disabled={added.size === 0}
                busy={creating}
                onPress={() => void create()}
                testID="add-songs-create"
              />
            </View>
          ) : (
            <Button label="Done" onPress={close} testID="add-songs-done" />
          )}
        </View>
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create(theme => ({
  body: { gap: space.sm, padding: space.xs },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  footActions: { flexDirection: 'row', gap: space.sm },
  error: { color: theme.colors.danger, fontSize: type.small, paddingHorizontal: space.xs },
  hint: { color: theme.colors.textMuted, fontSize: type.small, padding: space.xs, flexShrink: 1 },
}))
