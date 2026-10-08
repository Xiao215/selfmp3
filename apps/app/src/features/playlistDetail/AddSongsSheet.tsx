import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { artistOr, formatDuration, fuzzyRank, type Song } from '@selfmp3/shared'
import {
  failureText,
  radius,
  space,
  type,
  useAddToPlaylist,
  useBulkTag,
  useLibrary,
} from '@selfmp3/client'
import { useArt } from '../../offline/useArt'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { useAccent } from '../../ui/accent'
import { Button } from '../../ui/components/Button'
import { Check, Plus } from '../../ui/components/Icons'
import { Sheet } from '../../ui/components/Sheet'
import { EmptyState } from '../../ui/components/EmptyState'
import { SearchField } from '../../ui/components/SearchField'
import { SongLine } from '../../ui/components/SongLine'

/** Enough to scroll through; a search narrows past it. */
const SHOWN = 60

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
  const { theme } = useUnistyles()
  const accent = useAccent()
  const artFor = useArt(ROW_COVER_SIZE)
  const { data: library } = useLibrary()
  const addToPlaylist = useAddToPlaylist()
  const bulkTag = useBulkTag()
  const [query, setQuery] = useState('')
  const [added, setAdded] = useState<ReadonlySet<number>>(new Set())
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const making = target.kind === 'new'
  const tagging = target.kind === 'tag'
  const inPlaylist =
    target.kind === 'existing' ? target.inPlaylist : target.kind === 'tag' ? target.inTag : NOTHING

  const results = useMemo(() => {
    const songs = library?.songs ?? []
    if (!query.trim()) {
      return [...songs].sort((a, b) => b.addedAt.localeCompare(a.addedAt)).slice(0, SHOWN)
    }
    return fuzzyRank(query, songs, song => `${song.title} ${song.artist} ${song.album}`)
      .slice(0, SHOWN)
      .map(match => match.item)
  }, [library?.songs, query])

  const close = (): void => {
    onClose()
    setQuery('')
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
      setQuery('')
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
        <SearchField
          raised
          value={query}
          onChangeText={setQuery}
          placeholder="Search your library"
          autoCorrect={false}
          autoCapitalize="none"
          autoFocus
        />

        <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
          {results.length === 0 ? (
            <EmptyState compact title={`Nothing matches “${query.trim()}”`} />
          ) : (
            results.map(song => {
              const justAdded = added.has(song.id)
              const already = !justAdded && inPlaylist.has(song.id)
              return (
                <SongLine
                  key={song.id}
                  style={[styles.row, already && styles.already]}
                  artUri={artFor(song)}
                  coverTitle={song.album || song.title}
                  title={song.title}
                  sub={`${artistOr(song.artist)} · ${formatDuration(song.duration)}`}
                  trailing={
                    already ? (
                      <Text style={styles.state}>{tagging ? 'Has it' : 'In this list'}</Text>
                    ) : justAdded ? (
                      <Pressable
                        onPress={() => unpick(song)}
                        disabled={!making && !tagging}
                        accessibilityRole={making || tagging ? 'button' : undefined}
                        accessibilityLabel={
                          tagging
                            ? `Take the tag off ${song.title}`
                            : making
                              ? `Take ${song.title} back out`
                              : `${song.title} added`
                        }
                        style={styles.addedMark}
                      >
                        <Check size={14} color={accent.accent} />
                        <Text style={[styles.state, { color: accent.accent }]}>
                          {tagging ? 'Tagged' : 'Added'}
                        </Text>
                      </Pressable>
                    ) : (
                      <Pressable
                        onPress={() => add(song)}
                        accessibilityRole="button"
                        accessibilityLabel={tagging ? `Tag ${song.title}` : `Add ${song.title}`}
                        style={({ pressed }) => [styles.add, pressed && styles.pressed]}
                      >
                        <Plus size={15} color={theme.colors.textPrimary} />
                      </Pressable>
                    )
                  }
                />
              )
            })
          )}
        </ScrollView>

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
  list: { maxHeight: 380 },
  row: { paddingHorizontal: space.xs },
  already: { opacity: 0.55 },
  state: { color: theme.colors.textMuted, fontSize: type.small, fontWeight: '600' },
  addedMark: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    minWidth: 64,
    justifyContent: 'flex-end',
  },
  // Each + adds at once, and there is one on every row, so it is a quiet round
  // control rather than the accent: forty accent buttons would be a wall.
  add: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.surface3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
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
