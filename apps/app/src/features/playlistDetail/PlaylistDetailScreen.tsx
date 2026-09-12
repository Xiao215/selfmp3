import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { formatBytes, formatLongDuration, type Song } from '@selfmp3/shared'
import { useLibrary, useManifest, usePlaylistSongs, useToggleLoved } from '../../api/queries'
import { bytesToDownload, isDownloaded, colors, space, type } from '@selfmp3/client'
import { useDownloads } from '../../offline/DownloadsProvider'
import { usePlayer } from '../../player/PlayerProvider'
import { useAccent } from '../../ui/accent'
import { Button } from '../../ui/components/Button'
import { IconButton } from '../../ui/components/IconButton'
import {
  ChevronLeft,
  CloudDownload,
  Downloaded,
  Play,
  Shuffle,
  Sparkles,
} from '../../ui/components/Icons'
import { SongMenu } from '../../ui/components/SongMenu'
import { SongRow } from '../../ui/components/SongRow'
import { useArt } from '../../offline/useArt'

/**
 * One playlist, in order: the web's detail view with its header of actions —
 * play, shuffle, and the phone's own third, keeping the whole list on this
 * device.
 */
export function PlaylistDetailScreen(): ReactNode {
  const artFor = useArt()
  const accent = useAccent()
  const params = useLocalSearchParams<{ id: string }>()
  const playlistId = Number(params.id)
  const router = useRouter()

  const library = useLibrary()
  const manifest = useManifest()
  const contents = usePlaylistSongs(Number.isInteger(playlistId) ? playlistId : null)
  const player = usePlayer()
  const toggleLoved = useToggleLoved()
  const { state: downloads, queue: downloadQueue } = useDownloads()
  const [menuSong, setMenuSong] = useState<Song | null>(null)

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
  const currentId = player.current?.id ?? null
  const playing = player.isPlaying

  const renderSong = useCallback(
    ({ item, index }: { item: Song; index: number }) => (
      <SongRow
        song={item}
        artUri={artFor(item)}
        active={currentId === item.id}
        playing={playing}
        downloaded={downloaded(item.id)}
        onPress={() => player.playFrom(songIds, index)}
        onMore={() => setMenuSong(item)}
        onToggleLoved={() => toggleLoved.mutate({ id: item.id, loved: !item.loved })}
      />
    ),
    [artFor, currentId, playing, songIds, downloaded, player, toggleLoved],
  )

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.backRow}>
          <IconButton onPress={() => router.back()} label="Back to playlists">
            <ChevronLeft size={22} color={colors.textSecondary} />
          </IconButton>
          <Text style={styles.backLabel}>Playlists</Text>
        </View>

        <View style={styles.titleRow}>
          {playlist?.kind === 'smart' ? <Sparkles size={20} color={accent.accent} /> : null}
          <Text style={styles.heading} numberOfLines={2}>
            {playlist?.name ?? 'Playlist'}
          </Text>
        </View>
        <Text style={styles.meta}>
          {songs.length} {songs.length === 1 ? 'song' : 'songs'} ·{' '}
          {formatLongDuration(songs.reduce((sum, song) => sum + song.duration, 0))}
          {playlist?.kind === 'smart' ? ' · updates itself' : ''}
        </Text>
        {playlist?.description ? (
          <Text style={styles.description}>{playlist.description}</Text>
        ) : null}

        <View style={styles.actions}>
          <Button
            label="Play"
            icon={<Play size={15} color={colors.onAccent} />}
            variant="primary"
            disabled={songs.length === 0}
            onPress={() => player.playFrom(songIds, 0, false)}
          />
          <Button
            label="Shuffle"
            icon={<Shuffle size={15} color={colors.textPrimary} />}
            disabled={songs.length === 0}
            onPress={() => player.playShuffled(songIds)}
          />
          <Button
            testID={pendingBytes > 0 ? 'playlist-download' : 'playlist-downloaded'}
            label={pendingBytes > 0 ? formatBytes(pendingBytes) : 'On this phone'}
            icon={
              pendingBytes > 0 ? (
                <CloudDownload size={15} color={colors.textPrimary} />
              ) : (
                <Downloaded size={15} color={accent.accent} knockout={colors.surface2} />
              )
            }
            disabled={pendingBytes === 0}
            onPress={() => downloadQueue.enqueue(songIds)}
          />
        </View>
      </View>

      {contents.isPending ? (
        <ActivityIndicator style={styles.spinner} color={accent.accent} />
      ) : (
        <FlatList
          data={songs}
          keyExtractor={song => String(song.id)}
          renderItem={renderSong}
          initialNumToRender={16}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>This playlist is empty.</Text>}
        />
      )}

      <SongMenu song={menuSong} onClose={() => setMenuSong(null)} />
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
    paddingTop: space.xs,
    paddingBottom: space.lg,
    gap: 3,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: -space.md,
    marginBottom: space.xs,
  },
  backLabel: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    marginLeft: -6,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  heading: {
    flexShrink: 1,
    color: colors.textPrimary,
    fontSize: type.large,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  meta: {
    color: colors.textMuted,
    fontSize: 13,
  },
  description: {
    color: colors.textSecondary,
    fontSize: type.small,
    lineHeight: 17,
    marginTop: space.xs,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    marginTop: space.md,
  },
  list: {
    paddingTop: space.xs,
    paddingBottom: space.md,
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
