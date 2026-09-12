import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { formatLongDuration, type Song } from '@selfmp3/shared'
import { mediaUrl } from '../src/api/client'
import { useLibrary } from '../src/api/queries'
import { DEFAULT_FILTER, filterSongs, SORT_OPTIONS, usedTags } from '../src/lib/library'
import { isDownloaded } from '../src/offline/downloadIndex'
import { useDownloads } from '../src/offline/DownloadsProvider'
import { usePlayer } from '../src/player/PlayerProvider'
import { useConnection } from '../src/server/ConnectionProvider'
import { Chip } from '../src/ui/components/Chip'
import { SongRow } from '../src/ui/components/SongRow'
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
  const { connection } = useConnection()
  const { state: downloads } = useDownloads()

  const [filter, setFilter] = useState(DEFAULT_FILTER)

  const songs = useMemo(() => library.data?.songs ?? [], [library.data])
  const tags = useMemo(() => usedTags(songs, library.data?.tags ?? []), [songs, library.data])

  const downloaded = useCallback(
    (songId: number) => isDownloaded(downloads.index, songId),
    [downloads.index],
  )

  const visible = useMemo(() => filterSongs(songs, filter, downloaded), [songs, filter, downloaded])

  const songIds = useMemo(() => visible.map(song => song.id), [visible])
  const totalSeconds = useMemo(
    () => visible.reduce((sum, song) => sum + song.duration, 0),
    [visible],
  )

  const renderSong = useCallback(
    ({ item, index }: { item: Song; index: number }) => (
      <SongRow
        song={item}
        artUri={item.hasArt && connection ? mediaUrl.art(connection, item.id, item.rev) : null}
        active={player.current?.id === item.id}
        downloaded={downloaded(item.id)}
        onPress={() => player.playFrom(songIds, index)}
        onLongPress={() => player.playNext([item.id])}
      />
    ),
    [connection, player, songIds, downloaded],
  )

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.heading}>Library</Text>
        <Text style={styles.count}>
          {visible.length} song{visible.length === 1 ? '' : 's'} ·{' '}
          {formatLongDuration(totalSeconds)}
        </Text>
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

      <View style={styles.chips}>
        {SORT_OPTIONS.map(option => (
          <Chip
            key={option.field}
            label={
              filter.sort === option.field && filter.descending ? `${option.label} ↓` : option.label
            }
            selected={filter.sort === option.field}
            onPress={() =>
              setFilter(current => ({
                ...current,
                sort: option.field,
                // Tapping the active sort flips its direction, which is how
                // the web app's column headers behave.
                descending: current.sort === option.field ? !current.descending : false,
              }))
            }
          />
        ))}
        <Chip
          label="Downloaded"
          selected={filter.downloadedOnly}
          onPress={() =>
            setFilter(current => ({ ...current, downloadedOnly: !current.downloadedOnly }))
          }
        />
      </View>

      {tags.length > 0 ? (
        <View style={styles.chips}>
          {tags.map(tag => (
            <Chip
              key={tag.id}
              label={tag.name}
              hue={tag.hue}
              selected={filter.tagId === tag.id}
              onPress={() =>
                setFilter(current => ({
                  ...current,
                  tagId: current.tagId === tag.id ? null : tag.id,
                }))
              }
            />
          ))}
        </View>
      ) : null}

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
