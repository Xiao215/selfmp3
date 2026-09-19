import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { formatDuration, fuzzyRank, type Song } from '@selfmp3/shared'
import { radius, space, useAddToPlaylist, useLibrary } from '@selfmp3/client'
import { useArt } from '../../offline/useArt'
import { useAccent } from '../../ui/accent'
import { Button } from '../../ui/components/Button'
import { Cover } from '../../ui/components/Cover'
import { Check, Plus, Search } from '../../ui/components/Icons'
import { Sheet } from '../../ui/components/Sheet'

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
 */
export function AddSongsSheet({
  open,
  onClose,
  playlistName,
  target,
}: {
  open: boolean
  onClose: () => void
  playlistName: string
  target: AddSongsTarget
}): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const artFor = useArt()
  const { data: library } = useLibrary()
  const addToPlaylist = useAddToPlaylist()
  const [query, setQuery] = useState('')
  const [added, setAdded] = useState<ReadonlySet<number>>(new Set())
  const [focused, setFocused] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const making = target.kind === 'new'
  const inPlaylist = target.kind === 'existing' ? target.inPlaylist : NOTHING

  const results = useMemo(() => {
    const songs = (library?.songs ?? []).filter(song => !song.missing)
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
    setAdded(current => new Set(current).add(song.id))
  }

  /** Only while making one: nothing has been sent, so a pick can be taken back. */
  const unpick = (song: Song): void =>
    setAdded(current => {
      const next = new Set(current)
      next.delete(song.id)
      return next
    })

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
      setError(`Couldn’t make “${playlistName}”: ${(caught as Error).message}`)
    } finally {
      setCreating(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      title={`Add to ${playlistName}`}
      width={480}
      testID="add-songs"
    >
      <View style={styles.body}>
        <View style={[styles.search, focused && { borderColor: accent.accent }]}>
          <Search size={15} color={theme.colors.textMuted} />
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Search your library"
            placeholderTextColor={theme.colors.textMuted}
            accessibilityLabel="Search your library"
            autoCorrect={false}
            autoCapitalize="none"
            autoFocus
          />
        </View>

        <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
          {results.length === 0 ? (
            <Text style={styles.hint}>Nothing matches “{query.trim()}”.</Text>
          ) : (
            results.map(song => {
              const justAdded = added.has(song.id)
              const already = !justAdded && inPlaylist.has(song.id)
              return (
                <View key={song.id} style={[styles.row, already && styles.already]}>
                  <Cover uri={artFor(song)} title={song.album || song.title} size={36} />
                  <View style={styles.text}>
                    <Text style={styles.title} numberOfLines={1}>
                      {song.title}
                    </Text>
                    <Text style={styles.artist} numberOfLines={1}>
                      {song.artist || 'Unknown artist'}
                    </Text>
                  </View>
                  <Text style={styles.time}>{formatDuration(song.duration)}</Text>
                  {already ? (
                    <Text style={styles.state}>In this list</Text>
                  ) : justAdded ? (
                    <Pressable
                      onPress={() => unpick(song)}
                      disabled={!making}
                      accessibilityRole={making ? 'button' : undefined}
                      accessibilityLabel={
                        making ? `Take ${song.title} back out` : `${song.title} added`
                      }
                      style={styles.addedMark}
                    >
                      <Check size={14} color={accent.accent} />
                      <Text style={[styles.state, { color: accent.accent }]}>Added</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={() => add(song)}
                      accessibilityRole="button"
                      accessibilityLabel={`Add ${song.title}`}
                      style={({ pressed }) => [styles.add, pressed && styles.pressed]}
                    >
                      <Plus size={15} color={theme.colors.textPrimary} />
                    </Pressable>
                  )}
                </View>
              )
            })
          )}
        </ScrollView>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.foot}>
          <Text style={styles.hint}>
            {added.size > 0 ? `${added.size} added` : making ? 'Pick its first songs' : ' '}
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
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    minHeight: 38,
    // A search field on the sheet, raised above it whether the sheet is a
    // card (a phone) or the control surface (a dialog). The edge only
    // carries the focus ring: at rest it is the fill's own colour.
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.surface3,
    backgroundColor: theme.colors.surface3,
  },
  input: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.textPrimary,
    fontSize: 14,
    paddingVertical: 8,
  },
  list: { maxHeight: 380 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 5,
    paddingHorizontal: space.xs,
  },
  already: { opacity: 0.55 },
  text: { flex: 1, minWidth: 0 },
  title: { color: theme.colors.textPrimary, fontSize: 13, fontWeight: '500' },
  artist: { color: theme.colors.textMuted, fontSize: 11.5 },
  time: { color: theme.colors.textMuted, fontSize: 11.5, fontVariant: ['tabular-nums'] },
  state: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '600' },
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
  error: { color: theme.colors.danger, fontSize: 12, paddingHorizontal: space.xs },
  hint: { color: theme.colors.textMuted, fontSize: 12, padding: space.xs, flexShrink: 1 },
}))
