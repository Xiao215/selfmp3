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
 * Filling a playlist without leaving it.
 *
 * Search the library and press + on as many songs as you like: each is added
 * as it is pressed and the window stays open. Songs already in the playlist
 * say so instead of offering a second copy. With nothing typed it shows the
 * newest songs first, which is usually what was just imported to add.
 */
export function AddSongsSheet({
  open,
  onClose,
  playlistId,
  playlistName,
  inPlaylist,
}: {
  open: boolean
  onClose: () => void
  playlistId: number
  playlistName: string
  inPlaylist: ReadonlySet<number>
}): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const artFor = useArt()
  const { data: library } = useLibrary()
  const addToPlaylist = useAddToPlaylist()
  const [query, setQuery] = useState('')
  const [added, setAdded] = useState<ReadonlySet<number>>(new Set())
  const [focused, setFocused] = useState(false)

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
  }

  const add = (song: Song): void => {
    addToPlaylist.mutate({ playlistId, songIds: [song.id] })
    setAdded(current => new Set(current).add(song.id))
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
                    <View style={styles.addedMark} accessibilityLabel={`${song.title} added`}>
                      <Check size={14} color={accent.accent} />
                      <Text style={[styles.state, { color: accent.accent }]}>Added</Text>
                    </View>
                  ) : (
                    <Pressable
                      onPress={() => add(song)}
                      accessibilityRole="button"
                      accessibilityLabel={`Add ${song.title}`}
                      style={({ pressed }) => [
                        styles.add,
                        { backgroundColor: accent.accent },
                        pressed && styles.pressed,
                      ]}
                    >
                      <Plus size={15} color={accent.onAccent} />
                    </Pressable>
                  )}
                </View>
              )
            })
          )}
        </ScrollView>

        <View style={styles.foot}>
          <Text style={styles.hint}>{added.size === 0 ? ' ' : `${added.size} added`}</Text>
          <Button label="Done" variant="primary" onPress={close} testID="add-songs-done" />
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
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    backgroundColor: theme.colors.surface1,
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
  add: {
    width: 32,
    height: 28,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hint: { color: theme.colors.textMuted, fontSize: 12, padding: space.xs },
}))
