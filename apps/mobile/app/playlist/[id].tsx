import { useCallback, useMemo } from 'react'
import type { ReactNode } from 'react'
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { formatBytes, formatLongDuration, type Song } from '@selfmp3/shared'
import { useLibrary, useManifest, usePlaylistSongs } from '../../src/api/queries'
import { bytesToDownload, isDownloaded } from '../../src/offline/downloadIndex'
import { useDownloads } from '../../src/offline/DownloadsProvider'
import { usePlayer } from '../../src/player/PlayerProvider'
import { Button } from '../../src/ui/components/Button'
import { SongRow } from '../../src/ui/components/SongRow'
import { colors, space, type } from '../../src/ui/theme'
import { useArt } from '../../src/offline/useArt'

/** One playlist, in order, with play-all and download-this-playlist. */
export default function PlaylistDetailScreen(): ReactNode {
  const artFor = useArt()
  const params = useLocalSearchParams<{ id: string }>()
  const playlistId = Number(params.id)
  const router = useRouter()

  const library = useLibrary()
  const manifest = useManifest()
  const contents = usePlaylistSongs(Number.isInteger(playlistId) ? playlistId : null)
  const player = usePlayer()
  const { state: downloads, queue: downloadQueue } = useDownloads()

  const playlist = library.data?.playlists.find(entry => entry.id === playlistId) ?? null

  const songs = useMemo(() => {
    const byId = new Map((library.data?.songs ?? []).map(song => [song.id, song]))
    return (contents.data?.songIds ?? [])
      .map(id => byId.get(id))
      .filter((song): song is Song => song !== undefined)
  }, [library.data, contents.data])

  const songIds = useMemo(() => songs.map(song => song.id), [songs])
  const downloaded = useCallback(
    (songId: number) => isDownloaded(downloads.index, songId),
    [downloads.index],
  )

  const pendingBytes = manifest.data ? bytesToDownload(downloads.index, manifest.data, songIds) : 0

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
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.back}>‹ Playlists</Text>
        </Pressable>
        <Text style={styles.heading} numberOfLines={2}>
          {playlist?.name ?? 'Playlist'}
        </Text>
        <Text style={styles.meta}>
          {songs.length} song{songs.length === 1 ? '' : 's'} ·{' '}
          {formatLongDuration(songs.reduce((sum, song) => sum + song.duration, 0))}
        </Text>
        {playlist?.description ? (
          <Text style={styles.description}>{playlist.description}</Text>
        ) : null}

        <View style={styles.actions}>
          <Button
            label="Play"
            variant="primary"
            disabled={songs.length === 0}
            onPress={() => player.playFrom(songIds, 0)}
          />
          <Button
            label="Shuffle"
            disabled={songs.length === 0}
            onPress={() => player.playShuffled(songIds)}
          />
          <Button
            label={pendingBytes > 0 ? `Download ${formatBytes(pendingBytes)}` : 'Downloaded'}
            disabled={pendingBytes === 0}
            onPress={() => downloadQueue.enqueue(songIds)}
          />
        </View>
      </View>

      {contents.isPending ? (
        <ActivityIndicator style={styles.spinner} color={colors.accent} />
      ) : (
        <FlatList
          data={songs}
          keyExtractor={song => String(song.id)}
          renderItem={renderSong}
          initialNumToRender={16}
          ListEmptyComponent={<Text style={styles.empty}>This playlist is empty.</Text>}
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
    paddingTop: space.sm,
    paddingBottom: space.md,
    gap: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  back: {
    color: colors.accent,
    fontSize: type.small,
    fontWeight: '600',
    marginBottom: space.sm,
  },
  heading: {
    color: colors.textPrimary,
    fontSize: type.large,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  meta: {
    color: colors.textMuted,
    fontSize: type.small,
  },
  description: {
    color: colors.textSecondary,
    fontSize: type.small,
    marginTop: space.xs,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    marginTop: space.md,
  },
  spinner: {
    marginTop: space.xl,
  },
  empty: {
    color: colors.textMuted,
    fontSize: type.body,
    textAlign: 'center',
    marginTop: space.xl,
  },
})
