import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { Song } from '@selfmp3/shared'
import { useLibrary } from '../src/api/queries'
import { useArt } from '../src/offline/useArt'
import { DEFAULT_FILTER, filterSongs } from '../src/lib/library'
import { isDownloaded } from '../src/offline/downloadIndex'
import { useDownloads } from '../src/offline/DownloadsProvider'
import { usePlayer } from '../src/player/PlayerProvider'
import { SongRow } from '../src/ui/components/SongRow'
import { SyncStatus } from '../src/ui/components/SyncStatus'
import { colors, radius, space, type } from '../src/ui/theme'

/**
 * The library: search, sort, tag filter.
 *
 * All three run over the full in-memory list, exactly as on the web — the
 * whole library arrives in one response, so filtering locally costs one pass
 * over an array and no round trip.
 */
export default function LibraryScreen(): ReactNode {
  const library = useLibrary()
  const player = usePlayer()
  const { state: downloads } = useDownloads()

  const [filter, setFilter] = useState(DEFAULT_FILTER)

  const songs = useMemo(() => library.data?.songs ?? [], [library.data])

  const downloaded = useCallback(
    (songId: number) => isDownloaded(downloads.index, songId),
    [downloads.index],
  )

  const visible = useMemo(() => filterSongs(songs, filter, downloaded), [songs, filter, downloaded])

  const songIds = useMemo(() => visible.map(song => song.id), [visible])

  const artFor = useArt()

  const renderSong = useCallback(
    ({ item, index }: { item: Song; index: number }) => (
      <SongRow
        song={item}
        artUri={artFor(item)}
        active={player.current?.id === item.id}
        downloaded={downloaded(item.id)}
        onPress={() => player.playFrom(songIds, index)}
        onLongPress={() => player.playNext([item.id])}
      />
    ),
    [artFor, player, songIds, downloaded],
  )

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.heading}>Library</Text>
      </View>

      <TextInput
        style={styles.search}
        value={filter.query}
        onChangeText={query => setFilter(current => ({ ...current, query }))}
        placeholder="Search title, artist, album"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        returnKeyType="search"
      />

      <SyncStatus songs={songs} />


      {library.isPending ? (
        <ActivityIndicator style={styles.spinner} color={colors.accent} />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={song => String(song.id)}
          renderItem={renderSong}
          initialNumToRender={16}
          windowSize={11}
          removeClippedSubviews
          keyboardDismissMode="on-drag"
          ListEmptyComponent={
            <Text style={styles.empty}>
              {library.isError
                ? 'Could not reach the server, and nothing is cached yet.'
                : 'Nothing matches.'}
            </Text>
          }
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface0,
  },
  header: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  heading: {
    color: colors.textPrimary,
    fontSize: type.large,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  count: {
    color: colors.textMuted,
    fontSize: type.small,
  },
  search: {
    marginHorizontal: space.lg,
    marginTop: space.md,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    color: colors.textPrimary,
    fontSize: type.body,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.xs,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
  },
  spinner: {
    marginTop: space.xl,
  },
  empty: {
    color: colors.textMuted,
    fontSize: type.body,
    textAlign: 'center',
    marginTop: space.xl,
    paddingHorizontal: space.xl,
  },
})
