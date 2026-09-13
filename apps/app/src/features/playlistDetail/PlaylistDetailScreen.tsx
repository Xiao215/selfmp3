import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import type { GestureResponderEvent } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import Svg, { Path } from 'react-native-svg'
import { useQueryClient } from '@tanstack/react-query'
import { formatBytes, formatLongDuration, type Song } from '@selfmp3/shared'
import { bytesToDownload, clientApi, colors, queryKeys, radius, space, type } from '@selfmp3/client'
import {
  useDeletePlaylist,
  useLibrary,
  useManifest,
  usePlaylistSongs,
  useRemoveFromPlaylist,
  useUpdatePlaylist,
} from '../../api/queries'
import { useDownloads } from '../../offline/DownloadsProvider'
import { useArt } from '../../offline/useArt'
import { usePlayer } from '../../player/PlayerProvider'
import { modifiersOf, useSelection } from '../../selection/useSelection'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../../ui/accent'
import { Button } from '../../ui/components/Button'
import { ConfirmDialog } from '../../ui/components/ConfirmDialog'
import { IconButton } from '../../ui/components/IconButton'
import {
  CheckSquare,
  ChevronLeft,
  CloudDownload,
  Downloaded,
  Play,
  Shuffle,
  Sparkles,
  Trash,
} from '../../ui/components/Icons'
import { SelectionBar } from '../../ui/components/SelectionBar'
import { SongMenu } from '../../ui/components/SongMenu'
import { PlaylistSongRow } from './PlaylistSongRow'
import { SmartRuleBuilder } from './SmartRuleBuilder'
import { dropIndex, moveItem } from './playlistDetail.model'

/**
 * One playlist: the web's `PlaylistDetailView`.
 *
 * A manual playlist is yours to arrange: drag a track by its grip, take one out
 * with its ✕, or select several and remove them together. A smart playlist
 * builds itself from its rules, so it has neither grip nor ✕ — its order and
 * its contents are the rules'.
 *
 * The header names it (a pencil renames it in place), says how long it is, and
 * carries Select, Play, Shuffle and delete. Deleting asks first, and keeps the
 * songs. On a phone it also keeps the whole list on the device, and a way back.
 */
export function PlaylistDetailScreen(): ReactNode {
  const artFor = useArt()
  const accent = useAccent()
  const { wide, finePointer } = useLayout()
  const params = useLocalSearchParams<{ id: string }>()
  const playlistId = Number(params.id)
  const router = useRouter()
  const queryClient = useQueryClient()

  const library = useLibrary()
  const manifest = useManifest()
  const contents = usePlaylistSongs(Number.isInteger(playlistId) ? playlistId : null)
  const player = usePlayer()
  const updatePlaylist = useUpdatePlaylist()
  const deletePlaylist = useDeletePlaylist()
  const removeFromPlaylist = useRemoveFromPlaylist()
  const { state: downloads, downloadByHand } = useDownloads()

  const [menuSong, setMenuSong] = useState<Song | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [editingRules, setEditingRules] = useState(false)
  const [titleHovered, setTitleHovered] = useState(false)
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null)
  const [rowHeight, setRowHeight] = useState(0)

  const playlist = library.data?.playlists.find(entry => entry.id === playlistId) ?? null
  const manual = playlist?.kind === 'manual'

  const songs = useMemo(() => {
    const byId = new Map((library.data?.songs ?? []).map(song => [song.id, song]))
    return (contents.data?.songIds ?? [])
      .map(id => byId.get(id))
      .filter((song): song is Song => song !== undefined)
  }, [library.data, contents.data])
  const songIds = useMemo(() => songs.map(song => song.id), [songs])

  const selection = useSelection(songIds)
  const selectedSongs = useMemo(
    () => songs.filter(song => selection.has(song.id)),
    [songs, selection],
  )

  const pendingBytes = manifest.data ? bytesToDownload(downloads.index, manifest.data, songIds) : 0
  const currentId = player.current?.id ?? null

  /**
   * Move a track, and show it moved at once. The server is told the whole new
   * order; the cached list changes first, or the row would snap back until the
   * query happened to refetch, which makes a good drag look like a failed one.
   */
  const moveTo = useCallback(
    (from: number, to: number): void => {
      const ids = moveItem(songIds, from, to)
      queryClient.setQueryData(queryKeys.playlistSongs(playlistId), {
        ...(contents.data ?? { playlistId }),
        playlistId,
        songIds: ids,
      })
      void clientApi()
        .reorderPlaylist(playlistId, ids)
        .catch(
          () =>
            void queryClient.invalidateQueries({ queryKey: queryKeys.playlistSongs(playlistId) }),
        )
    },
    [songIds, queryClient, playlistId, contents.data],
  )

  const dragStart = (index: number): void => setDrag({ from: index, over: index })
  const dragMove = (index: number, dy: number): void =>
    setDrag({ from: index, over: dropIndex(index, dy, rowHeight, songs.length) })
  const dragEnd = (index: number, dy: number): void => {
    const to = dropIndex(index, dy, rowHeight, songs.length)
    setDrag(null)
    if (to !== index) moveTo(index, to)
  }

  const startRenaming = (): void => {
    if (!playlist) return
    setDraftName(playlist.name)
    setRenaming(true)
  }

  const saveName = (): void => {
    const trimmed = draftName.trim()
    if (playlist && trimmed && trimmed !== playlist.name) {
      updatePlaylist.mutate({ id: playlist.id, patch: { name: trimmed } })
    }
    setRenaming(false)
  }

  if (!library.isPending && !playlist) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.missing}>
          <Text style={styles.emptyTitle}>Playlist not found</Text>
          <Button label="Back to playlists" onPress={() => router.replace('/playlists')} />
        </View>
      </SafeAreaView>
    )
  }

  const totalSeconds = songs.reduce((sum, song) => sum + song.duration, 0)

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        scrollEnabled={drag === null}
        keyboardShouldPersistTaps="handled"
      >
        {wide ? null : (
          <View style={styles.backRow}>
            <IconButton onPress={() => router.back()} label="Back to playlists">
              <ChevronLeft size={22} color={colors.textSecondary} />
            </IconButton>
            <Text style={styles.backLabel}>Playlists</Text>
          </View>
        )}

        <View style={[styles.head, wide && styles.headWide]}>
          <View style={styles.titles}>
            {renaming ? (
              <TextInput
                style={styles.renameInput}
                value={draftName}
                onChangeText={setDraftName}
                onSubmitEditing={saveName}
                onBlur={() => setRenaming(false)}
                autoFocus
                accessibilityLabel="Playlist name"
              />
            ) : (
              <View
                style={styles.titleRow}
                onPointerEnter={finePointer ? () => setTitleHovered(true) : undefined}
                onPointerLeave={finePointer ? () => setTitleHovered(false) : undefined}
              >
                {playlist?.kind === 'smart' ? <Sparkles size={20} color={accent.accent} /> : null}
                <Text style={styles.heading} numberOfLines={2} accessibilityRole="header">
                  {playlist?.name ?? 'Playlist'}
                </Text>
                {playlist ? (
                  <View style={{ opacity: !finePointer || titleHovered ? 1 : 0 }}>
                    <IconButton onPress={startRenaming} label={`Rename ${playlist.name}`} size={24}>
                      <Pencil />
                    </IconButton>
                  </View>
                ) : null}
              </View>
            )}
            <Text style={styles.meta}>
              {songs.length} {songs.length === 1 ? 'song' : 'songs'} ·{' '}
              {formatLongDuration(totalSeconds)}
              {playlist?.kind === 'smart'
                ? ' · updates itself'
                : songs.length > 1 && !selection.active
                  ? ' · drag the handles to reorder'
                  : ''}
            </Text>
          </View>

          <View style={styles.actions}>
            <Button
              label={selection.active ? 'Done' : 'Select'}
              active={selection.active}
              icon={<CheckSquare size={15} color={colors.textPrimary} />}
              disabled={songs.length === 0}
              onPress={() => (selection.active ? selection.clear() : selection.enter())}
            />
            <Button
              label="Play"
              icon={<Play size={15} color={accent.onAccent} />}
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
            {playlist?.kind === 'smart' ? (
              <Button
                label={editingRules ? 'Done' : 'Edit rules'}
                active={editingRules}
                onPress={() => setEditingRules(open => !open)}
              />
            ) : null}
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
              onPress={() => downloadByHand(songIds)}
            />
            {playlist ? (
              <Button
                icon={<Trash size={15} color={colors.danger} />}
                variant="danger"
                accessibilityLabel={`Delete the playlist ${playlist.name}`}
                onPress={() => setConfirmingDelete(true)}
              />
            ) : null}
          </View>
        </View>

        {playlist?.kind === 'smart' && editingRules ? (
          <SmartRuleBuilder
            key={playlist.id}
            rules={playlist.rules ?? undefined}
            tags={library.data?.tags ?? []}
            onChange={rules =>
              updatePlaylist.mutate(
                { id: playlist.id, patch: { rules } },
                {
                  // The rules decide what is in it, so the list follows them.
                  onSuccess: () =>
                    void queryClient.invalidateQueries({
                      queryKey: queryKeys.playlistSongs(playlist.id),
                    }),
                },
              )
            }
          />
        ) : null}

        {selection.active && playlist ? (
          <SelectionBar
            songs={selectedSongs}
            total={songs.length}
            scope="in this playlist"
            allSelected={selection.allSelected}
            onSelectAll={selection.selectAll}
            onDeselectAll={selection.deselectAll}
            onDone={selection.clear}
            // A smart playlist has no membership to edit, so removing from it
            // would be a lie.
            playlist={manual ? { id: playlist.id, name: playlist.name } : undefined}
          />
        ) : null}

        {contents.isPending ? (
          <ActivityIndicator style={styles.spinner} color={accent.accent} />
        ) : songs.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>{playlist?.kind === 'smart' ? '✨' : '📼'}</Text>
            <Text style={styles.emptyTitle}>Nothing here yet</Text>
            <Text style={styles.emptyHint}>
              {playlist?.kind === 'smart'
                ? 'No songs match these rules yet. Try loosening them — the count above the rules updates as you type.'
                : 'Add songs from the library using the ⋯ menu on any track.'}
            </Text>
            {playlist?.kind === 'smart' && editingRules ? null : (
              <Button
                label={playlist?.kind === 'smart' ? 'Edit the rules' : 'Go to the library'}
                onPress={() =>
                  playlist?.kind === 'smart' ? setEditingRules(true) : router.navigate('/')
                }
              />
            )}
          </View>
        ) : (
          <View
            style={styles.list}
            role="table"
            aria-label={`${playlist?.name ?? 'Playlist'} songs`}
          >
            {songs.map((song, index) => (
              <PlaylistSongRow
                key={song.id}
                song={song}
                index={index}
                artUri={artFor(song)}
                active={currentId === song.id}
                manual={manual}
                playlistName={playlist?.name ?? ''}
                selecting={selection.active}
                selected={selection.has(song.id)}
                dragging={drag?.from === index}
                dropTarget={drag !== null && drag.over === index && drag.from !== index}
                onDragStart={manual ? () => dragStart(index) : undefined}
                onDragMove={manual ? dy => dragMove(index, dy) : undefined}
                onDragEnd={manual ? dy => dragEnd(index, dy) : undefined}
                onToggleSelect={() => selection.toggle(song.id)}
                onPress={(event: GestureResponderEvent) => {
                  // Cmd, Shift and selection mode select; anything else plays
                  // from here.
                  if (selection.click(song.id, modifiersOf(event))) return
                  player.playFrom(songIds, index)
                }}
                onLongPress={() => setMenuSong(song)}
                onRemove={() => removeFromPlaylist.mutate({ playlistId, songId: song.id })}
                onLayoutHeight={index === 0 ? setRowHeight : undefined}
              />
            ))}
          </View>
        )}
      </ScrollView>

      <SongMenu song={menuSong} onClose={() => setMenuSong(null)} />
      <ConfirmDialog
        open={confirmingDelete}
        title={`Delete the playlist “${playlist?.name ?? ''}”?`}
        body="Your songs are kept."
        confirmLabel="Delete playlist"
        danger
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={() => {
          setConfirmingDelete(false)
          if (!playlist) return
          deletePlaylist.mutate(playlist.id)
          router.replace('/playlists')
        }}
      />
    </SafeAreaView>
  )
}

/** A pencil, for the rename affordance, as the web draws it. */
function Pencil(): ReactNode {
  return (
    <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
      <Path d="M12 20h9" stroke={colors.textMuted} strokeWidth={2} strokeLinecap="round" />
      <Path
        d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"
        stroke={colors.textMuted}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xl },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: -space.md,
    marginTop: space.xs,
  },
  backLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', marginLeft: -6 },
  head: { paddingTop: space.sm, paddingBottom: space.lg, gap: space.md },
  headWide: {
    paddingTop: 18,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 20,
  },
  titles: { flexShrink: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  heading: {
    flexShrink: 1,
    color: colors.textPrimary,
    fontSize: type.large,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  renameInput: {
    color: colors.textPrimary,
    fontSize: type.large,
    fontWeight: '700',
    paddingVertical: 2,
    paddingHorizontal: space.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    backgroundColor: colors.surface2,
  },
  meta: { color: colors.textMuted, fontSize: 13, marginTop: 3 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  list: { gap: 0 },
  spinner: { marginTop: space.xl },
  empty: { alignItems: 'center', gap: space.sm, paddingTop: 60 },
  emptyEmoji: { fontSize: 34 },
  emptyTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
  emptyHint: { color: colors.textMuted, fontSize: 13, textAlign: 'center', marginBottom: space.sm },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md },
})
