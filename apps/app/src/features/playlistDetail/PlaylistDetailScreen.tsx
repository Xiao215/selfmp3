import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { ActivityIndicator, Animated, Pressable, Text, TextInput, View } from 'react-native'
import type { FlatListProps, GestureResponderEvent } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
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
  useDeletePlaylist,
  useLibrary,
  useManifest,
  usePlaylistSongs,
  useRemoveFromPlaylist,
  useUpdatePlaylist,
} from '@selfmp3/client'
import { useDownloads } from '../../offline/DownloadsProvider'
import { useArt } from '../../offline/useArt'
import { useIsCurrentSong, usePlayer } from '../../player/PlayerProvider'
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
import { SELECTION_BAR_SPACE, SelectionBar } from '../../ui/components/SelectionBar'
import { SheetItem } from '../../ui/components/Sheet'
import { SongList } from '../../ui/components/SongList'
import { SongMenu } from '../../ui/components/SongMenu'
import { PlaylistCover } from '../playlists/PlaylistCover'
import { copyName, isLive, LIVE_NAME, newPlaylist } from '../playlists/playlists.model'
import { usePlaylistPlayback } from '../playlists/usePlaylistPlayback'
import { AddSongsSheet } from './AddSongsSheet'
import { PlaylistSongRow } from './PlaylistSongRow'
import { RulesPanel, RulesSheet } from './RulesEditor'
import { RulesSummary } from './RulesSummary'
import { cameFrom, dropIndex, moveItem } from './playlistDetail.model'

/**
 * One playlist.
 *
 * The head is the playlist itself: its cover, name, description and length,
 * then one loud button, Play, with Shuffle beside it. Everything else a
 * playlist can have done to it — queueing, pinning, renaming, copying,
 * deleting — waits in its ⋯, so none of it sits a thumb's width from Play.
 * A phone's head is in the computer's order, Play and Shuffle at the start and
 * Download, ＋ and ⋯ at the end; an empty playlist shows none of Play, Shuffle
 * or the head's Add songs, which could only do nothing.
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
  const navigation = useNavigation()
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
  // The row being moved and the row it would land on. Not how far it has
  // travelled: that is `dragY`, which moves the row without a render.
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null)
  const [dragY] = useState(() => new Animated.Value(0))
  const [rowHeight, setRowHeight] = useState(0)
  /*
   * Where the list is scrolled, and how tall the head above the songs is: at
   * desktop width the selection bar floats just under the head and follows it
   * up as it scrolls away, then stays at the top. An animated value fed by the
   * list's scroll, so following it draws nothing.
   */
  const [scrollY] = useState(() => new Animated.Value(0))
  const [headHeight, setHeadHeight] = useState(0)
  const barTop = useMemo(
    () =>
      scrollY.interpolate({
        inputRange: [0, Math.max(1, headHeight)],
        outputRange: [headHeight, 0],
        extrapolate: 'clamp',
      }),
    [scrollY, headHeight],
  )
  const onListScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
        useNativeDriver: false,
      }),
    [scrollY],
  )

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
  // A string of its own rather than a read off `playlist`: the rows' memo
  // depends on it, and the compiler cannot vouch for a value that still points
  // into an object handed to the mutations below.
  const name = `${playlist?.name ?? 'Playlist'}`

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

  /*
   * What a row's handlers read at the moment they run, so the handlers are
   * made once (`rowActions`) and a row's memo holds. Inline closures per row
   * redrew every row on every render of this screen.
   */
  const latest = useRef({ songIds, rowHeight, moveTo, selection, playback, playlistId, removeFromPlaylist })
  useEffect(() => {
    latest.current = { songIds, rowHeight, moveTo, selection, playback, playlistId, removeFromPlaylist }
  })

  /*
   * A move.
   *
   * The pointer's travel goes into `dragY`, which the lifted cell reads
   * (`LiftedCell`), so following the pointer is no render at all; it used to
   * be state, and every pointer event redrew every row. State changes when
   * the move starts, when it crosses into another row (the drop line moves),
   * and when it ends.
   */
  const dragStart = useCallback(
    (index: number) => {
      dragY.setValue(0)
      setDrag({ from: index, over: index })
    },
    [dragY],
  )
  const dragMove = useCallback(
    (index: number, dy: number) => {
      dragY.setValue(dy)
      const now = latest.current
      const over = dropIndex(index, dy, now.rowHeight, now.songIds.length)
      setDrag(current =>
        current !== null && current.from === index && current.over === over
          ? current
          : { from: index, over },
      )
    },
    [dragY],
  )
  const dragEnd = useCallback((index: number, dy: number) => {
    const now = latest.current
    const to = dropIndex(index, dy, now.rowHeight, now.songIds.length)
    // `dragY` is left where it is: the lift ends in the same render as the
    // move, and resetting it first would show the row back in its old place
    // for a frame.
    setDrag(null)
    if (to !== index) now.moveTo(index, to)
  }, [])

  const rowActions = useMemo<RowActions>(
    () => ({
      dragStart,
      dragMove,
      dragEnd,
      press: (event, songId, index) => {
        const now = latest.current
        // Cmd, Shift and selection mode select; anything else plays from here.
        if (now.selection.click(songId, modifiersOf(event))) return
        now.playback.playFrom(now.playlistId, now.songIds, index)
      },
      more: (anchor, song) => {
        menuAnchorRef.current = anchor
        // The ⋯ again closes its own menu.
        setMenuSong(current => (current?.id === song.id ? null : song))
      },
      toggleSelect: songId => latest.current.selection.toggle(songId),
      remove: songId => {
        const now = latest.current
        now.removeFromPlaylist.mutate({ playlistId: now.playlistId, songId })
      },
      measure: setRowHeight,
    }),
    [dragStart, dragMove, dragEnd],
  )

  const liftedFrom = drag?.from ?? null
  const lift = useMemo(() => ({ from: liftedFrom, dragY }), [liftedFrom, dragY])

  // Not on this phone and no server to stream it from: faded.
  const unreachableHere = library.isError && installed
  const menuSongId = menuSong?.id ?? null
  const renderSong = useCallback(
    ({ item, index }: { item: Song; index: number }) => (
      <PlaylistRow
        song={item}
        index={index}
        artUri={artFor(item)}
        unavailable={unreachableHere && !isDownloaded(downloads.index, item.id)}
        manual={manual}
        playlistName={name}
        selecting={selection.active}
        selected={selection.has(item.id)}
        dragging={drag?.from === index}
        dropTarget={drag !== null && drag.over === index && drag.from !== index}
        menuOpen={menuSongId === item.id}
        actions={rowActions}
      />
    ),
    [
      artFor,
      unreachableHere,
      downloads.index,
      manual,
      name,
      selection,
      drag,
      menuSongId,
      rowActions,
    ],
  )

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
  const nothing = songs.length === 0
  // Known to be empty, not merely not loaded yet: Play, Shuffle and the head's
  // Add songs go, and the empty state's own Add songs is the one way in.
  const emptyPlaylist = count === 0

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
  // Nothing to download in an empty playlist, and "Downloaded" would be a boast.
  const offlineButton = installed && !emptyPlaylist ? (
    <IconButton
      testID={pendingBytes > 0 ? 'playlist-download' : 'playlist-downloaded'}
      onPress={() => downloadByHand(songIds)}
      label={pendingBytes > 0 ? `Download · ${formatBytes(pendingBytes)}` : 'Downloaded'}
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

  // Above the songs, and scrolled with them: the songs are a virtualised list
  // now — a live playlist with no rules is the whole library — and this is its
  // header rather than the top of a ScrollView drawing every row at once.
  const header = (
    <View onLayout={event => setHeadHeight(Math.round(event.nativeEvent.layout.height))}>
      {wide ? null : (
        <Pressable
          // Back when the Playlists page is behind; after a playlist made from a
          // selection, or a link, Playlists takes this page's place instead.
          onPress={() =>
            cameFrom(navigation.getState(), 'playlists/index')
              ? router.back()
              : router.replace('/playlists')
          }
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
              {emptyPlaylist ? null : playButton}
              {emptyPlaylist ? null : shuffleButton}
              {offlineButton}
              {moreButton}
              <View style={styles.spacer} />
              {manual && !emptyPlaylist ? (
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
            {/* The computer's order: Play and Shuffle first, the rest at the far end. */}
            <View style={styles.controls}>
              {emptyPlaylist ? null : playButton}
              {emptyPlaylist ? null : shuffleButton}
              <View style={styles.spacer} />
              {offlineButton}
              {manual && !emptyPlaylist ? (
                <IconButton onPress={() => setAdding(true)} label="Add songs" testID="playlist-add-songs">
                  <Plus size={20} color={theme.colors.textSecondary} />
                </IconButton>
              ) : null}
              {moreButton}
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

    </View>
  )

  // What stands where the songs would, when there are none (the list shows it
  // only then): loading, a server that is not answering, or an empty playlist.
  const empty = contents.isPending ? (
    <ActivityIndicator style={styles.spinner} color={accent.accent} />
  ) : contents.isError ? (
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
  ) : (
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
  )

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.split}>
        {/* The songs, and the selection bar floating over them: no row moves when it comes. */}
        <View style={styles.listArea}>
          <LiftContext.Provider value={lift}>
            <SongList
              songs={songs}
              label={`${name} songs`}
              renderSong={renderSong}
              header={header}
              empty={empty}
              style={styles.scroll}
              contentContainerStyle={[
                styles.content,
                selection.active && !wide && { paddingBottom: SELECTION_BAR_SPACE },
              ]}
              scrollEnabled={drag === null}
              keyboardShouldPersistTaps="handled"
              // A name or a description being typed in the head stays open through a scroll.
              keyboardDismissMode="none"
              CellRendererComponent={LiftedCell}
              onScroll={wide ? onListScroll : undefined}
            />
          </LiftContext.Provider>

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
              top={barTop}
            />
          ) : null}
        </View>

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
          // A phone has no sidebar to pin to: there it is the Playlists page's Pinned row.
          label={
            wide
              ? playlist?.pinned
                ? 'Unpin from sidebar'
                : 'Pin to sidebar'
              : playlist?.pinned
                ? 'Unpin'
                : 'Pin'
          }
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

/** What a row can ask of the screen. Made once, so a row's memo holds. */
interface RowActions {
  readonly dragStart: (index: number) => void
  readonly dragMove: (index: number, dy: number) => void
  readonly dragEnd: (index: number, dy: number) => void
  readonly press: (event: GestureResponderEvent, songId: number, index: number) => void
  readonly more: (anchor: View | null, song: Song) => void
  readonly toggleSelect: (songId: number) => void
  readonly remove: (songId: number) => void
  readonly measure: (height: number) => void
}

/**
 * One track, with its handlers bound to its song and place.
 *
 * `PlaylistSongRow` takes handlers with no arguments, so something has to
 * close over the song and the index; done here, with hooks, each handler is
 * remade only when its row moves. Done in the list's render, every handler of
 * every row was new each time and the row's memo never held.
 */
const PlaylistRow = memo(function PlaylistRow({
  song,
  index,
  artUri,
  unavailable,
  manual,
  playlistName,
  selecting,
  selected,
  dragging,
  dropTarget,
  menuOpen,
  actions,
}: {
  song: Song
  index: number
  artUri: string | null
  unavailable: boolean
  manual: boolean
  playlistName: string
  selecting: boolean
  selected: boolean
  dragging: boolean
  dropTarget: boolean
  menuOpen: boolean
  actions: RowActions
}): ReactNode {
  // Asked per row, so a song change redraws two rows rather than the list.
  const active = useIsCurrentSong(song.id)
  const songId = song.id
  const onDragStart = useCallback(() => actions.dragStart(index), [actions, index])
  const onDragMove = useCallback((dy: number) => actions.dragMove(index, dy), [actions, index])
  const onDragEnd = useCallback((dy: number) => actions.dragEnd(index, dy), [actions, index])
  const onPress = useCallback(
    (event: GestureResponderEvent) => actions.press(event, songId, index),
    [actions, songId, index],
  )
  const onMore = useCallback((anchor: View | null) => actions.more(anchor, song), [actions, song])
  const onToggleSelect = useCallback(() => actions.toggleSelect(songId), [actions, songId])
  const onRemove = useCallback(() => actions.remove(songId), [actions, songId])

  return (
    <PlaylistSongRow
      song={song}
      index={index}
      artUri={artUri}
      active={active}
      unavailable={unavailable}
      manual={manual}
      playlistName={playlistName}
      selecting={selecting}
      selected={selected}
      dragging={dragging}
      // The cell carries the travel, as an animated value (`LiftedCell`).
      dragOffset={0}
      dropTarget={dropTarget}
      menuOpen={menuOpen}
      onDragStart={manual ? onDragStart : undefined}
      onDragMove={manual ? onDragMove : undefined}
      onDragEnd={manual ? onDragEnd : undefined}
      onToggleSelect={onToggleSelect}
      onPress={onPress}
      onMore={onMore}
      onRemove={manual ? onRemove : undefined}
      onLayoutHeight={index === 0 ? actions.measure : undefined}
    />
  )
})

/** Which row is lifted, and how far it has travelled. */
const LiftContext = createContext<{ from: number | null; dragY: Animated.Value | null }>({
  from: null,
  dragY: null,
})

type CellProps = ComponentProps<NonNullable<FlatListProps<Song>['CellRendererComponent']>>

/**
 * A list cell that can be lifted: over its neighbours, and following the
 * pointer by an animated value rather than by re-rendering.
 *
 * On the cell rather than the row because a list puts each row in a cell of
 * its own, and on a phone a raised `zIndex` only counts among siblings — a
 * row raised inside its cell still slid under the next cell. Reads the lift
 * from context, so this component stays the same one for the list's life and
 * starting a move does not remount every row, and its gesture with it.
 */
function LiftedCell({ index, style, onLayout, onFocusCapture, children }: CellProps): ReactNode {
  const { from, dragY } = useContext(LiftContext)
  return (
    <Animated.View
      style={[
        style,
        dragY !== null && from === index ? { zIndex: 2, transform: [{ translateY: dragY }] } : null,
      ]}
      onLayout={onLayout}
      // The list's own cell passes this on to a View, which takes it on both
      // platforms; the types of Animated.View just do not name it.
      {...{ onFocusCapture }}
    >
      {children}
    </Animated.View>
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  split: { flex: 1, flexDirection: 'row' },
  listArea: { flex: 1, minWidth: 0 },
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
