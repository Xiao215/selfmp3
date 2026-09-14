import { useCallback, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import type { GestureResponderEvent } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import { formatBytes, formatLongDuration, type Song } from '@selfmp3/shared'
import {
  bytesToDownload,
  clientApi,
  isDownloaded,
  queryKeys,
  radius,
  space,
  type,
} from '@selfmp3/client'
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
import { showToast } from '../../ui/toast'
import { tip } from '../../ui/tip'
import { Button } from '../../ui/components/Button'
import { ConfirmDialog } from '../../ui/components/ConfirmDialog'
import { IconButton } from '../../ui/components/IconButton'
import {
  ChevronLeft,
  CloudDownload,
  Copy,
  Downloaded,
  ListMusic,
  Live,
  More,
  Pencil,
  Pin,
  Play,
  Plus,
  Queue,
  Shuffle,
  Trash,
} from '../../ui/components/Icons'
import { Popover } from '../../ui/components/Popover'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { SelectionBar } from '../../ui/components/SelectionBar'
import { SheetItem } from '../../ui/components/Sheet'
import { SongMenu } from '../../ui/components/SongMenu'
import { PlaylistCover } from '../playlists/PlaylistCover'
import { copyName, isLive, LIVE_NAME, newPlaylist } from '../playlists/playlists.model'
import { usePlaylistPlayback } from '../playlists/usePlaylistPlayback'
import { AddSongsSheet } from './AddSongsSheet'
import { PlaylistSongRow } from './PlaylistSongRow'
import { RulesPanel, RulesSheet } from './RulesEditor'
import { RulesSummary } from './RulesSummary'
import { dropIndex, moveItem } from './playlistDetail.model'

/**
 * One playlist.
 *
 * The head is the playlist itself: its cover, name, description and length,
 * then one loud button, Play, with Shuffle beside it. Everything else a
 * playlist can have done to it — queueing, pinning, renaming, copying,
 * deleting — waits in its ⋯, so none of it sits a thumb's width from Play.
 *
 * A playlist you made adds Add songs, which searches the library without
 * leaving; its rows move by their grip at desktop width and by holding them on
 * a phone. A live playlist reads its rules back as a sentence instead, and
 * edits them in a panel beside the songs (a sheet on a phone), so the songs
 * the rules pick stay what the page shows.
 *
 * Arriving with `?rules=1` opens the rules (a live playlist just made), and
 * with `?rename=1` the name (a playlist just made from a selection).
 */
export function PlaylistDetailScreen(): ReactNode {
  const { theme } = useUnistyles()
  const artFor = useArt()
  const accent = useAccent()
  const { wide, finePointer } = useLayout()
  const params = useLocalSearchParams<{ id: string; rules?: string; rename?: string }>()
  const playlistId = Number(params.id)
  const router = useRouter()
  const queryClient = useQueryClient()

  const library = useLibrary()
  const manifest = useManifest()
  const contents = usePlaylistSongs(Number.isInteger(playlistId) ? playlistId : null)
  const player = usePlayer()
  const playback = usePlaylistPlayback()
  const updatePlaylist = useUpdatePlaylist()
  const deletePlaylist = useDeletePlaylist()
  const removeFromPlaylist = useRemoveFromPlaylist()
  const { state: downloads, installed, downloadByHand } = useDownloads()

  const [menuSong, setMenuSong] = useState<Song | null>(null)
  const menuAnchorRef = useRef<View | null>(null)
  const [headMenuOpen, setHeadMenuOpen] = useState(false)
  const headMenuRef = useRef<View>(null)
  const [renaming, setRenaming] = useState(params.rename === '1')
  const [draftName, setDraftName] = useState<string | null>(null)
  const [describing, setDescribing] = useState(false)
  const [draftDescription, setDraftDescription] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [editingRules, setEditingRules] = useState(params.rules === '1')
  const [adding, setAdding] = useState(false)
  const [drag, setDrag] = useState<{ from: number; over: number; dy: number } | null>(null)
  const [rowHeight, setRowHeight] = useState(0)

  const playlist = library.data?.playlists.find(entry => entry.id === playlistId) ?? null
  const live = playlist !== null && isLive(playlist)
  const manual = playlist?.kind === 'manual'
  const tags = library.data?.tags ?? []

  const songs = useMemo(() => {
    const byId = new Map((library.data?.songs ?? []).map(song => [song.id, song]))
    return (contents.data?.songIds ?? [])
      .map(id => byId.get(id))
      .filter((song): song is Song => song !== undefined)
  }, [library.data, contents.data])
  const songIds = useMemo(() => songs.map(song => song.id), [songs])
  const inPlaylist = useMemo(() => new Set(songIds), [songIds])

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
   * query happened to refetch, which makes a good move look like a failed one.
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

  const dragStart = (index: number): void => setDrag({ from: index, over: index, dy: 0 })
  const dragMove = (index: number, dy: number): void =>
    setDrag({ from: index, over: dropIndex(index, dy, rowHeight, songs.length), dy })
  const dragEnd = (index: number, dy: number): void => {
    const to = dropIndex(index, dy, rowHeight, songs.length)
    setDrag(null)
    if (to !== index) moveTo(index, to)
  }

  const saveName = (): void => {
    const trimmed = (draftName ?? '').trim()
    if (playlist && draftName !== null && trimmed && trimmed !== playlist.name) {
      updatePlaylist.mutate({ id: playlist.id, patch: { name: trimmed } })
    }
    setRenaming(false)
    setDraftName(null)
  }

  const saveDescription = (): void => {
    const trimmed = (draftDescription ?? '').trim()
    if (playlist && draftDescription !== null && trimmed !== playlist.description) {
      updatePlaylist.mutate({ id: playlist.id, patch: { description: trimmed } })
    }
    setDescribing(false)
    setDraftDescription(null)
  }

  /** A copy: a live playlist's rules, or a playlist's songs as they are now. */
  const makeCopy = async (kind: 'manual' | 'live'): Promise<void> => {
    if (!playlist) return
    const input = newPlaylist(
      kind,
      copyName(playlist.name, (library.data?.playlists ?? []).map(entry => entry.name)),
      { description: playlist.description, rules: playlist.rules ?? undefined },
    )
    if (!input) return
    try {
      const created = await clientApi().createPlaylist(input)
      if (kind === 'manual' && songIds.length > 0) {
        await clientApi().addToPlaylist(created.id, { songIds })
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.library })
      showToast(`Made “${created.name}”`, 'good')
      router.push({ pathname: '/playlists/[id]', params: { id: String(created.id) } })
    } catch (caught) {
      showToast(`Couldn’t copy “${playlist.name}”: ${(caught as Error).message}`, 'error')
    }
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

  const count = contents.data ? songs.length : (playlist?.songCount ?? 0)
  const seconds = contents.data
    ? songs.reduce((sum, song) => sum + song.duration, 0)
    : (playlist?.totalDuration ?? 0)
  const name = playlist?.name ?? 'Playlist'
  const nothing = songs.length === 0

  const menuAction = (run: () => void) => (): void => {
    setHeadMenuOpen(false)
    run()
  }
  const menuIcon = (Glyph: typeof Queue, color = theme.colors.textSecondary): ReactNode => (
    <Glyph size={16} color={color} />
  )

  const titles = (
    <View style={styles.titles}>
      <View style={styles.eyebrow}>
        {live ? <Live size={13} color={accent.accent} /> : null}
        <Text style={[styles.eyebrowText, live && { color: accent.accent }]}>
          {live
            ? `${LIVE_NAME} playlist · updates itself`
            : playlist?.pinned
              ? 'Playlist · pinned'
              : 'Playlist'}
        </Text>
      </View>
      {renaming ? (
        <TextInput
          style={[styles.heading, styles.headingInput]}
          value={draftName ?? playlist?.name ?? ''}
          onChangeText={setDraftName}
          onSubmitEditing={saveName}
          onBlur={saveName}
          selectTextOnFocus
          autoFocus
          accessibilityLabel="Playlist name"
        />
      ) : (
        <Pressable
          onPress={() => setRenaming(true)}
          disabled={!finePointer || !playlist}
          accessibilityRole="header"
          {...(finePointer ? tip('Rename') : {})}
        >
          <Text style={[styles.heading, !wide && styles.headingCompact]} numberOfLines={2}>
            {name}
          </Text>
        </Pressable>
      )}
      {describing ? (
        <TextInput
          style={[styles.description, styles.descriptionInput]}
          value={draftDescription ?? playlist?.description ?? ''}
          onChangeText={setDraftDescription}
          onSubmitEditing={saveDescription}
          onBlur={saveDescription}
          placeholder="What is this playlist for?"
          placeholderTextColor={theme.colors.textMuted}
          autoFocus
          accessibilityLabel="Playlist description"
        />
      ) : playlist?.description ? (
        <Text style={styles.description} numberOfLines={3}>
          {playlist.description}
        </Text>
      ) : null}
      <Text style={styles.meta}>
        {count} {count === 1 ? 'song' : 'songs'} · {formatLongDuration(seconds)}
      </Text>
    </View>
  )

  const playButton = (
    <Pressable
      onPress={() => playback.play(playlistId, songIds)}
      disabled={nothing}
      accessibilityRole="button"
      accessibilityLabel={`Play ${name}`}
      testID="playlist-play"
      {...tip('Play')}
      style={({ pressed }) => [
        styles.play,
        { backgroundColor: accent.accent },
        pressed && styles.playPressed,
        nothing && styles.disabled,
      ]}
    >
      <Play size={20} color={accent.onAccent} />
    </Pressable>
  )
  const shuffleButton = (
    <IconButton
      onPress={() => playback.shuffle(playlistId, songIds)}
      label={`Shuffle ${name}`}
      caption="Shuffle"
      disabled={nothing}
    >
      <Shuffle size={20} color={theme.colors.textSecondary} />
    </IconButton>
  )
  const offlineButton = installed ? (
    <IconButton
      testID={pendingBytes > 0 ? 'playlist-download' : 'playlist-downloaded'}
      onPress={() => downloadByHand(songIds)}
      label={pendingBytes > 0 ? `Keep on this phone, ${formatBytes(pendingBytes)}` : 'On this phone'}
      disabled={pendingBytes === 0}
    >
      {pendingBytes > 0 ? (
        <CloudDownload size={19} color={theme.colors.textSecondary} />
      ) : (
        <Downloaded size={19} color={accent.accent} knockout={theme.colors.surface0} />
      )}
    </IconButton>
  ) : null
  const moreButton = (
    <View ref={headMenuRef} collapsable={false}>
      <IconButton
        onPress={() => setHeadMenuOpen(open => !open)}
        label={`More actions for ${name}`}
        caption="More"
        active={headMenuOpen}
        testID="playlist-more"
      >
        <More size={19} color={theme.colors.textSecondary} />
      </IconButton>
    </View>
  )

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.split}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          scrollEnabled={drag === null}
          keyboardShouldPersistTaps="handled"
        >
          {wide ? null : (
            <Pressable
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Back to playlists"
              hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
              style={({ pressed }) => [styles.backRow, pressed && { opacity: 0.6 }]}
            >
              <ChevronLeft size={18} color={theme.colors.textSecondary} />
              <Text style={styles.backLabel}>Playlists</Text>
            </Pressable>
          )}

          {playlist ? (
            wide ? (
              <View style={styles.head}>
                <View style={styles.headTop}>
                  <PlaylistCover playlist={playlist} songIds={contents.data?.songIds} size={132} />
                  {titles}
                </View>
                <View style={styles.controls}>
                  {playButton}
                  {shuffleButton}
                  {offlineButton}
                  {moreButton}
                  <View style={styles.spacer} />
                  {manual ? (
                    <Button
                      label="Add songs"
                      icon={<Plus size={15} color={theme.colors.textPrimary} />}
                      onPress={() => setAdding(true)}
                      testID="playlist-add-songs"
                    />
                  ) : null}
                </View>
              </View>
            ) : (
              <View style={styles.head}>
                <PlaylistCover playlist={playlist} songIds={contents.data?.songIds} size={148} />
                {titles}
                <View style={styles.controls}>
                  {offlineButton}
                  {manual ? (
                    <IconButton onPress={() => setAdding(true)} label="Add songs" testID="playlist-add-songs">
                      <Plus size={20} color={theme.colors.textSecondary} />
                    </IconButton>
                  ) : null}
                  {moreButton}
                  <View style={styles.spacer} />
                  {shuffleButton}
                  {playButton}
                </View>
              </View>
            )
          ) : null}

          {live && playlist ? (
            <RulesSummary
              rules={playlist.rules}
              tags={tags}
              editing={editingRules}
              onEdit={() => setEditingRules(true)}
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
              // A live playlist has no membership to edit, so removing from it
              // would be a lie.
              playlist={manual ? { id: playlist.id, name: playlist.name } : undefined}
            />
          ) : null}

          {contents.isPending ? (
            <ActivityIndicator style={styles.spinner} color={accent.accent} />
          ) : contents.isError && nothing ? (
            // The list is the server's; the library knows only how long it is.
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Can’t reach your library</Text>
              <Text style={styles.emptyHint}>
                {playlist
                  ? `${playlist.songCount} ${playlist.songCount === 1 ? 'song is' : 'songs are'} in here, `
                  : ''}
                but the list lives on your server and it isn’t answering right now.
              </Text>
              <Button label="Try again" onPress={() => void contents.refetch()} />
            </View>
          ) : nothing ? (
            <View style={styles.empty}>
              {live ? (
                <Live size={30} color={theme.colors.textMuted} />
              ) : (
                <ListMusic size={30} color={theme.colors.textMuted} />
              )}
              <Text style={styles.emptyTitle}>
                {live ? 'No songs match these rules yet' : 'Nothing here yet'}
              </Text>
              <Text style={styles.emptyHint}>
                {live
                  ? 'Loosen a rule and the songs that match appear here as you change it.'
                  : 'Search your library and add as many songs as you like.'}
              </Text>
              {/* A live playlist's Edit rules is in the sentence just above. */}
              {live ? null : (
                <Button
                  label="Add songs"
                  variant="primary"
                  icon={<Plus size={15} color={accent.onAccent} />}
                  onPress={() => setAdding(true)}
                />
              )}
            </View>
          ) : (
            <View style={styles.list} role="table" aria-label={`${name} songs`}>
              {songs.map((song, index) => (
                <PlaylistSongRow
                  key={song.id}
                  song={song}
                  index={index}
                  artUri={artFor(song)}
                  active={currentId === song.id}
                  // Not on this phone and no Mac to stream it from: faded.
                  unavailable={library.isError && installed && !isDownloaded(downloads.index, song.id)}
                  manual={manual}
                  playlistName={name}
                  selecting={selection.active}
                  selected={selection.has(song.id)}
                  dragging={drag?.from === index}
                  dragOffset={drag?.from === index ? drag.dy : 0}
                  dropTarget={drag !== null && drag.over === index && drag.from !== index}
                  menuOpen={menuSong?.id === song.id}
                  onDragStart={manual ? () => dragStart(index) : undefined}
                  onDragMove={manual ? dy => dragMove(index, dy) : undefined}
                  onDragEnd={manual ? dy => dragEnd(index, dy) : undefined}
                  onToggleSelect={() => selection.toggle(song.id)}
                  onPress={(event: GestureResponderEvent) => {
                    // Cmd, Shift and selection mode select; anything else plays
                    // from here.
                    if (selection.click(song.id, modifiersOf(event))) return
                    playback.playFrom(playlistId, songIds, index)
                  }}
                  onMore={anchor => {
                    menuAnchorRef.current = anchor
                    // The ⋯ again closes its own menu.
                    setMenuSong(current => (current?.id === song.id ? null : song))
                  }}
                  onRemove={
                    manual ? () => removeFromPlaylist.mutate({ playlistId, songId: song.id }) : undefined
                  }
                  onLayoutHeight={index === 0 ? setRowHeight : undefined}
                />
              ))}
            </View>
          )}
        </ScrollView>

        {wide && live && playlist && editingRules ? (
          <RulesPanel playlist={playlist} tags={tags} onDone={() => setEditingRules(false)} />
        ) : null}
      </View>

      {!wide && live && playlist ? (
        <RulesSheet
          open={editingRules}
          playlist={playlist}
          tags={tags}
          onDone={() => setEditingRules(false)}
        />
      ) : null}

      <Popover
        open={headMenuOpen}
        onClose={() => setHeadMenuOpen(false)}
        anchorRef={headMenuRef}
        title={name}
        width={250}
        align="start"
        testID="playlist-menu"
      >
        <SheetItem
          icon={menuIcon(Queue)}
          label="Play next"
          disabled={nothing}
          onPress={menuAction(() => player.playNext(songIds))}
        />
        <SheetItem
          icon={menuIcon(ListMusic)}
          label="Add to queue"
          disabled={nothing}
          onPress={menuAction(() => player.addToQueue(songIds))}
        />
        <View style={styles.divider} />
        {live ? (
          <>
            <SheetItem
              icon={menuIcon(Live)}
              label="Edit rules"
              onPress={menuAction(() => setEditingRules(true))}
            />
            <SheetItem
              icon={menuIcon(Copy)}
              label="Save a copy as playlist"
              disabled={nothing}
              onPress={menuAction(() => void makeCopy('manual'))}
            />
          </>
        ) : null}
        <SheetItem
          icon={menuIcon(Pin)}
          label={playlist?.pinned ? 'Unpin from sidebar' : 'Pin to sidebar'}
          onPress={menuAction(() => {
            if (!playlist) return
            updatePlaylist.mutate({ id: playlist.id, patch: { pinned: !playlist.pinned } })
            showToast(playlist.pinned ? `Unpinned ${playlist.name}` : `Pinned ${playlist.name}`, 'good')
          })}
        />
        <SheetItem icon={menuIcon(Pencil)} label="Rename" onPress={menuAction(() => setRenaming(true))} />
        <SheetItem
          icon={menuIcon(Pencil)}
          label={playlist?.description ? 'Edit description' : 'Add a description'}
          onPress={menuAction(() => setDescribing(true))}
        />
        <SheetItem
          icon={menuIcon(Copy)}
          label="Duplicate"
          onPress={menuAction(() => void makeCopy(live ? 'live' : 'manual'))}
        />
        <View style={styles.divider} />
        <SheetItem
          icon={menuIcon(Trash, theme.colors.danger)}
          label="Delete playlist…"
          danger
          onPress={menuAction(() => setConfirmingDelete(true))}
        />
      </Popover>

      <SongMenu
        song={menuSong}
        anchorRef={menuAnchorRef}
        onClose={() => setMenuSong(null)}
        onStartSelecting={song => selection.enter(song.id)}
        playlist={manual && playlist ? { id: playlist.id, name: playlist.name } : undefined}
      />

      {manual && playlist ? (
        <AddSongsSheet
          open={adding}
          onClose={() => setAdding(false)}
          playlistId={playlist.id}
          playlistName={playlist.name}
          inPlaylist={inPlaylist}
        />
      ) : null}

      <ConfirmDialog
        open={confirmingDelete}
        title={`Delete the playlist “${name}”?`}
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

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  split: { flex: 1, flexDirection: 'row' },
  scroll: { flex: 1 },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xl },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 2,
    marginLeft: -4,
    marginTop: space.xs,
    minHeight: 32,
  },
  backLabel: { color: theme.colors.textSecondary, fontSize: 14, fontWeight: '600' },
  head: { paddingTop: space.md, paddingBottom: space.lg, gap: space.md },
  headTop: { flexDirection: 'row', alignItems: 'flex-end', gap: 20, paddingTop: space.sm },
  titles: { flexShrink: 1, minWidth: 0, gap: 3 },
  eyebrow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  eyebrowText: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '600' },
  heading: {
    color: theme.colors.textPrimary,
    fontSize: type.large + 6,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  headingCompact: { fontSize: type.large + 2 },
  headingInput: {
    paddingVertical: 2,
    paddingHorizontal: space.sm,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    borderRadius: radius.sm,
    backgroundColor: theme.colors.surface2,
  },
  description: { color: theme.colors.textSecondary, fontSize: 13, lineHeight: 18 },
  descriptionInput: {
    paddingVertical: 5,
    paddingHorizontal: space.sm,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    borderRadius: radius.sm,
    backgroundColor: theme.colors.surface2,
  },
  meta: { color: theme.colors.textMuted, fontSize: 12.5 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  spacer: { flex: 1 },
  play: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space.xs,
  },
  playPressed: { opacity: 0.8, transform: [{ scale: 0.96 }] },
  disabled: { opacity: 0.45 },
  divider: { height: 1, backgroundColor: theme.colors.border, marginVertical: space.xs },
  list: { gap: 0 },
  spinner: { marginTop: space.xl },
  empty: { alignItems: 'center', gap: space.sm, paddingTop: 48 },
  emptyTitle: { color: theme.colors.textPrimary, fontSize: 17, fontWeight: '700' },
  emptyHint: {
    color: theme.colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: space.sm,
    maxWidth: 320,
  },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md },
}))
