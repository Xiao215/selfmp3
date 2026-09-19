import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ComponentProps, ReactNode } from 'react'
import {
  ActivityIndicator,
  Animated,
  PanResponder,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native'
import type { FlatListProps, GestureResponderEvent } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import { formatBytes, formatLongDuration, type Song, type Tag } from '@selfmp3/shared'
import {
  bytesToDownload,
  clientApi,
  HIT_TARGET,
  isDownloaded,
  queryKeys,
  space,
  useDeletePlaylist,
  useLibrary,
  useManifest,
  usePlaylistSongs,
  useReorderPlaylist,
  useToggleLoved,
  useUpdatePlaylist,
} from '@selfmp3/client'
import { useDownloads } from '../../offline/DownloadsProvider'
import { useArt } from '../../offline/useArt'
import { usePlayer } from '../../player/PlayerProvider'
import { HoldToReorder } from '../../ui/components/HoldToReorder'
import { dragCursor } from '../../ports/dragCursor'
import { useNotADragSource } from '../../ports/songDrag'
import { modifiersOf, useSelection } from '../../selection/useSelection'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../../ui/accent'
import { showToast } from '../../ui/toast'
import { pageTitle } from '../../ui/surfaces'
import { tip } from '../../ui/tip'
import { Button, PlayButton } from '../../ui/components/Button'
import { ConfirmDialog } from '../../ui/components/ConfirmDialog'
import { IconButton } from '../../ui/components/IconButton'
import {
  ChevronLeft,
  CloudDownload,
  Copy,
  Downloaded,
  Grip,
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
import { SongRow } from '../../ui/components/SongRow'
import { TagPicker } from '../../ui/components/TagPicker'
import { tagLink } from '../tag/placeLinks'
import { songTagLookup } from '../library/library.model'
import { noteTagUsed } from '../library/recentTags.store'
import { usePullToRefresh } from '../library/usePullToRefresh'
import { PlaylistCover } from '../playlists/PlaylistCover'
import { copyName, FOLLOWS_LABEL, isLive, newPlaylist } from '../playlists/playlists.model'
import { usePlaylistPlayback } from '../playlists/usePlaylistPlayback'
import { AddSongsSheet } from './AddSongsSheet'
import { FollowsRow } from './FollowsRow'
import { cameFrom, dropIndex, movedTo } from './playlistDetail.model'

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
 * a phone. One that follows tags shows them instead, as a row of chips above
 * the songs, so what it is picking stays what the page shows.
 *
 * Arriving with `?rename=1` puts the cursor in the name — where a playlist
 * just saved from a tag pick sends you when you press Rename on the message —
 * and with `?add=1` the song picker (an empty playlist's tile in the grid).
 */
export function PlaylistDetailScreen(): ReactNode {
  const { theme } = useUnistyles()
  const artFor = useArt()
  const accent = useAccent()
  const { wide, finePointer } = useLayout()
  const params = useLocalSearchParams<{ id: string; rename?: string; add?: string }>()
  const playlistId = Number(params.id)
  const router = useRouter()
  const navigation = useNavigation()
  const queryClient = useQueryClient()

  const library = useLibrary()
  const manifest = useManifest()
  const contents = usePlaylistSongs(Number.isInteger(playlistId) ? playlistId : null)
  const pull = usePullToRefresh(contents.refetch)
  const player = usePlayer()
  const playback = usePlaylistPlayback()
  const updatePlaylist = useUpdatePlaylist()
  const deletePlaylist = useDeletePlaylist()
  const reorderPlaylist = useReorderPlaylist()
  const toggleLoved = useToggleLoved()
  const { state: downloads, installed, downloadByHand } = useDownloads()

  const [menuSong, setMenuSong] = useState<Song | null>(null)
  const menuAnchorRef = useRef<View | null>(null)
  // The dashed ＋ in a row's tag column, and the window it opens — the same
  // pair the library's rows have.
  const [taggingSong, setTaggingSong] = useState<Song | null>(null)
  const tagAnchorRef = useRef<View | null>(null)
  const [headMenuOpen, setHeadMenuOpen] = useState(false)
  const headMenuRef = useRef<View>(null)
  const [renaming, setRenaming] = useState(params.rename === '1')
  const [draftName, setDraftName] = useState<string | null>(null)
  const [describing, setDescribing] = useState(false)
  const [draftDescription, setDraftDescription] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  // With `?add=1` the song picker is already open: an empty playlist's tile in
  // the grid offers Add songs, and it lands here ready to pick.
  const [adding, setAdding] = useState(params.add === '1')
  // The row being moved and the row it would land on. Not how far it has
  // travelled: that is `dragY`, which moves the row without a render.
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null)
  const [dragY] = useState(() => new Animated.Value(0))
  const [rowHeight, setRowHeight] = useState(0)
  const playlist = library.data?.playlists.find(entry => entry.id === playlistId) ?? null
  const live = playlist !== null && isLive(playlist)
  const manual = playlist?.kind === 'manual'
  const tags = useMemo(() => library.data?.tags ?? [], [library.data])

  const songs = useMemo(() => {
    const byId = new Map((library.data?.songs ?? []).map(song => [song.id, song]))
    return (contents.data?.songIds ?? [])
      .map(id => byId.get(id))
      .filter((song): song is Song => song !== undefined)
  }, [library.data, contents.data])
  const songIds = useMemo(() => songs.map(song => song.id), [songs])
  const inPlaylist = useMemo(() => new Set(songIds), [songIds])
  // A row's chips, the library's way: looked up once per song and kept, so a
  // memoised row is not handed a new array on every render.
  const songTags = useMemo(() => songTagLookup(tags), [tags])

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

  /*
   * What a row's handlers read at the moment they run, so the handlers are
   * made once (`rowActions`) and a row's memo holds. Inline closures per row
   * redrew every row on every render of this screen.
   */
  const latest = useRef({
    songIds,
    rowHeight,
    selection,
    playback,
    playlistId,
    reorderPlaylist,
    toggleLoved,
    tags,
  })
  useEffect(() => {
    latest.current = {
      songIds,
      rowHeight,
      selection,
      playback,
      playlistId,
      reorderPlaylist,
      toggleLoved,
      tags,
    }
  })

  /*
   * A move.
   *
   * The pointer's travel goes into `dragY`, which the lifted cell reads
   * (`LiftedCell`), so following the pointer is no render at all — as state it
   * would redraw every row per pointer event. State changes when the move
   * starts, when it crosses into another row (the drop line moves), and when
   * it ends.
   */
  const dragStart = useCallback(
    (songId: number) => {
      const index = latest.current.songIds.indexOf(songId)
      if (index < 0) return
      dragY.setValue(0)
      setDrag({ from: index, over: index })
    },
    [dragY],
  )
  const dragMove = useCallback(
    (songId: number, dy: number) => {
      const now = latest.current
      const index = now.songIds.indexOf(songId)
      if (index < 0) return
      dragY.setValue(dy)
      const over = dropIndex(index, dy, now.rowHeight, now.songIds.length)
      setDrag(current =>
        current !== null && current.from === index && current.over === over
          ? current
          : { from: index, over },
      )
    },
    [dragY],
  )
  const dragEnd = useCallback((songId: number, dy: number) => {
    const now = latest.current
    const index = now.songIds.indexOf(songId)
    if (index < 0) return
    const moved = movedTo(now.songIds, index, dy, now.rowHeight)
    // `dragY` is left where it is: the lift ends in the same render as the
    // move, and resetting it first would show the row back in its old place
    // for a frame.
    setDrag(null)
    if (moved) {
      now.reorderPlaylist.mutate({ playlistId: now.playlistId, songIds: moved.songIds })
    }
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
      toggleSelect: song => latest.current.selection.toggle(song.id),
      toggleLoved: song => latest.current.toggleLoved.mutate({ id: song.id, loved: !song.loved }),
      // A chip here is a way out to the tag's own page, not a filter on the
      // playlist: narrowing a list you arranged by hand is not what a playlist
      // is for, and "the chill ones" is a question the tag's page answers.
      toggleTag: tagId => {
        const tag = latest.current.tags.find(entry => entry.id === tagId)
        if (!tag) return
        noteTagUsed(tagId)
        router.push(tagLink(tag.name))
      },
      editTags: (anchor, song) => {
        tagAnchorRef.current = anchor
        setTaggingSong(current => (current?.id === song.id ? null : song))
      },
      // Holding a row is how it is moved, so holding to select is the menu's
      // job here (`SongMenu`). Where there is no order to change, holding
      // selects, exactly as it does in the library.
      longPress: song => latest.current.selection.enter(song.id),
      measure: setRowHeight,
    }),
    [dragStart, dragMove, dragEnd, router],
  )

  const liftedFrom = drag?.from ?? null
  const lift = useMemo(() => ({ from: liftedFrom, dragY }), [liftedFrom, dragY])

  // Not on this phone and no server to stream it from: faded.
  const unreachableHere = library.isError && installed
  const menuSongId = menuSong?.id ?? null
  // A playlist you made can be put in any order you like; one that follows
  // tags is in the order its rule gives, so its rows show no grip and do not
  // lift under a held finger. Selection mode is not what reordering is for,
  // so the grip steps aside while it is on.
  const reorderable = manual && !selection.active
  const renderSong = useCallback(
    ({ item, index }: { item: Song; index: number }) => {
      const here = isDownloaded(downloads.index, item.id)
      return (
        <PlaylistRow
          testID={`song-row-${index}`}
          song={item}
          index={index}
          artUri={artFor(item)}
          downloaded={here}
          notDownloadedMark={installed && !here}
          unavailable={unreachableHere && !here}
          reorderable={reorderable}
          selecting={selection.active}
          selected={selection.has(item.id)}
          lifted={drag?.from === index}
          dropTarget={drag !== null && drag.over === index && drag.from !== index}
          menuOpen={menuSongId === item.id}
          tags={songTags(item)}
          actions={rowActions}
        />
      )
    },
    [
      artFor,
      installed,
      unreachableHere,
      downloads.index,
      reorderable,
      selection,
      drag,
      menuSongId,
      songTags,
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
      copyName(
        playlist.name,
        (library.data?.playlists ?? []).map(entry => entry.name),
      ),
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
            ? `Playlist · ${FOLLOWS_LABEL}`
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
          <Text style={styles.heading} numberOfLines={2}>
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

  // The page's one white Play (`S2`).
  const playButton = (
    <PlayButton
      onPress={() => playback.play(playlistId, songIds)}
      disabled={nothing}
      label={`Play ${name}`}
      testID="playlist-play"
      icon={<Play size={20} color={theme.colors.onPrimary} />}
    />
  )
  const shuffleButton = (
    <IconButton
      onPress={() => playback.shuffle(playlistId, songIds)}
      label={`Shuffle ${name}`}
      caption="Shuffle"
      disabled={nothing}
      filled
    >
      <Shuffle size={20} color={theme.colors.textSecondary} />
    </IconButton>
  )
  // Nothing to download in an empty playlist, and "Downloaded" would be a boast.
  const offlineButton =
    installed && !emptyPlaylist ? (
      <IconButton
        testID={pendingBytes > 0 ? 'playlist-download' : 'playlist-downloaded'}
        onPress={() => downloadByHand(songIds)}
        label={pendingBytes > 0 ? `Download · ${formatBytes(pendingBytes)}` : 'Downloaded'}
        disabled={pendingBytes === 0}
        filled
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
        filled
      >
        <More size={19} color={theme.colors.textSecondary} />
      </IconButton>
    </View>
  )

  // Above the songs, and scrolled with them: the songs are a virtualised list
  // now — a live playlist with no rules is the whole library — and this is its
  // header rather than the top of a ScrollView drawing every row at once.
  const header = (
    <View style={styles.gutter}>
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
                <IconButton
                  onPress={() => setAdding(true)}
                  label="Add songs"
                  testID="playlist-add-songs"
                  filled
                >
                  <Plus size={20} color={theme.colors.textSecondary} />
                </IconButton>
              ) : null}
              {moreButton}
            </View>
          </View>
        )
      ) : null}

      {live && playlist ? <FollowsRow playlist={playlist} tags={tags} /> : null}
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
          icon={<Plus size={15} color={theme.colors.textPrimary} />}
          onPress={() => setAdding(true)}
        />
      )}
    </View>
  )

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.split}>
        {/* The selection bar takes a lane above the songs, so it covers none of them. */}
        <View style={styles.listArea}>
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
              onRefresh={pull.onRefresh}
              refreshing={pull.refreshing}
            />
          </LiftContext.Provider>
        </View>
      </View>

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
          <SheetItem
            icon={menuIcon(Copy)}
            label="Save a copy as playlist"
            disabled={nothing}
            onPress={menuAction(() => void makeCopy('manual'))}
          />
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
            showToast(
              playlist.pinned ? `Unpinned ${playlist.name}` : `Pinned ${playlist.name}`,
              'good',
            )
          })}
        />
        <SheetItem
          icon={menuIcon(Pencil)}
          label="Rename"
          onPress={menuAction(() => setRenaming(true))}
        />
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

      {/* The dashed ＋ on a row, the same window the library's rows open. */}
      <TagPicker song={taggingSong} onClose={() => setTaggingSong(null)} anchorRef={tagAnchorRef} />

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
  /**
   * A move, named by the song rather than by where it sits. A row's place
   * changes when a move ends, and a gesture built around a place that has
   * changed since is a gesture that moves the wrong row — so the row's
   * handlers are made once, for its song, and last as long as the row does.
   */
  readonly dragStart: (songId: number) => void
  readonly dragMove: (songId: number, dy: number) => void
  readonly dragEnd: (songId: number, dy: number) => void
  readonly press: (event: GestureResponderEvent, songId: number, index: number) => void
  readonly more: (anchor: View | null, song: Song) => void
  readonly toggleSelect: (song: Song) => void
  readonly toggleLoved: (song: Song) => void
  readonly toggleTag: (tagId: number) => void
  readonly editTags: (anchor: View | null, song: Song) => void
  readonly longPress: (song: Song) => void
  readonly measure: (height: number) => void
}

/**
 * One track of a playlist: the library's row, with what a playlist adds.
 *
 * The row itself is `SongRow`, the same component and the same file the
 * library draws — a song row is a song row, and a playlist that had its own
 * was a playlist whose songs had no hearts, no tags and no colour under the
 * one that was playing. What a playlist adds is a grip to drag by at desktop
 * width, the lifted look while a row is being moved, and the line where it
 * would land; taking a song off the playlist is in the ⋯ menu, where
 * everything else done to a song already is.
 *
 * Only the handlers that need this row's place are made here — the press,
 * which plays from it, and the three that carry a move. The rest are the
 * screen's own, handed down unchanged, so the memo holds.
 */
const PlaylistRow = memo(function PlaylistRow({
  testID,
  song,
  index,
  artUri,
  downloaded,
  notDownloadedMark,
  unavailable,
  reorderable,
  selecting,
  selected,
  lifted,
  dropTarget,
  menuOpen,
  tags,
  actions,
}: {
  testID: string
  song: Song
  index: number
  artUri: string | null
  downloaded: boolean
  notDownloadedMark: boolean
  unavailable: boolean
  /** This playlist's order is yours to change, and nothing is being selected. */
  reorderable: boolean
  selecting: boolean
  selected: boolean
  lifted: boolean
  dropTarget: boolean
  menuOpen: boolean
  tags: readonly Tag[]
  actions: RowActions
}): ReactNode {
  const { wide } = useLayout()
  const songId = song.id
  const onDragStart = useCallback(() => actions.dragStart(songId), [actions, songId])
  const onDragMove = useCallback((dy: number) => actions.dragMove(songId, dy), [actions, songId])
  const onDragEnd = useCallback((dy: number) => actions.dragEnd(songId, dy), [actions, songId])
  const onPress = useCallback(
    (event: GestureResponderEvent) => actions.press(event, songId, index),
    [actions, songId, index],
  )

  // The grip belongs to a pointer: at desktop width it is the thing a mouse
  // aims at. On a phone the row is the handle and a 44-point grip would only
  // take the title's room, so there is none — holding the row is the gesture.
  const grip = useMemo(
    () =>
      wide && reorderable ? (
        <ReorderGrip
          song={song}
          onStart={onDragStart}
          onMove={onDragMove}
          onEnd={onDragEnd}
          dragging={lifted}
        />
      ) : null,
    [wide, reorderable, song, onDragStart, onDragMove, onDragEnd, lifted],
  )

  const holds = !wide && reorderable

  return (
    <HoldToReorder
      enabled={holds}
      onStart={onDragStart}
      onMove={onDragMove}
      onEnd={onDragEnd}
      onLayoutHeight={index === 0 ? actions.measure : undefined}
    >
      <SongRow
        testID={testID}
        song={song}
        artUri={artUri}
        downloaded={downloaded}
        notDownloadedMark={notDownloadedMark}
        unavailable={unavailable}
        index={index}
        tags={tags}
        selecting={selecting}
        selected={selected}
        menuOpen={menuOpen}
        leading={grip}
        lifted={lifted}
        dropTarget={dropTarget}
        onPress={onPress}
        onMore={actions.more}
        onToggleLoved={actions.toggleLoved}
        onToggleSelect={actions.toggleSelect}
        onToggleTag={actions.toggleTag}
        onEditTags={actions.editTags}
        // `null` while the hold is the move's: see `SongRow`.
        onLongPress={holds ? null : actions.longPress}
      />
    </HoldToReorder>
  )
})

/**
 * The grip a mouse drags a row by.
 *
 * A pan responder, where the held row uses gesture handler, and the reason is
 * the input rather than the platform. A pointer press on a grip is already a
 * statement of intent, so nothing has to be taken away from anything: React's
 * own responder system grants it at once and measures it to the pixel. The
 * held row cannot be that, which is why it is not — and gesture handler's web
 * build, which is exact enough for a finger's 350ms hold, lost about a third
 * of a mouse's travel here, landing rows one place short.
 *
 * The responder holds the travel so far, so one remade in the middle of a drag
 * starts counting from nothing and the row jumps: it is made once, and reads
 * this row's place when the drag runs rather than when it was built. The row
 * underneath never sees the press, so dragging cannot start a song by accident.
 */
const ReorderGrip = memo(function ReorderGrip({
  song,
  onStart,
  onMove,
  onEnd,
  dragging,
}: {
  song: Song
  onStart: () => void
  onMove: (dy: number) => void
  onEnd: (dy: number) => void
  dragging: boolean
}): ReactNode {
  const { theme } = useUnistyles()
  const { finePointer } = useLayout()
  // The row around this one is a drag source — a song drags onto a playlist in
  // the sidebar — and the browser's drag would swallow the grip's own.
  const gripRef = useRef<View>(null)
  useNotADragSource(gripRef)

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => onStart(),
        onPanResponderMove: (_event, gesture) => onMove(gesture.dy),
        onPanResponderRelease: (_event, gesture) => onEnd(gesture.dy),
        onPanResponderTerminate: () => onEnd(0),
      }),
    [onStart, onMove, onEnd],
  )

  return (
    <View
      ref={gripRef}
      {...pan.panHandlers}
      accessibilityRole="button"
      accessibilityLabel={`Move ${song.title}`}
      {...tip('Drag to reorder')}
      style={[styles.grip, !finePointer && styles.gripTouch, dragCursor(dragging)]}
    >
      <Grip size={16} color={theme.colors.textMuted} />
    </View>
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
  // No side padding on the list: the rows carry their own, as the library's
  // do, and an extra 16 here is what made the same row sit in a different
  // place on this page. The head and the empty state take it themselves.
  content: { paddingBottom: space.xl },
  gutter: { paddingHorizontal: space.lg },
  grip: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', marginLeft: -6 },
  gripTouch: { width: HIT_TARGET, height: HIT_TARGET },
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
  heading: pageTitle(theme.colors),
  // A field in place of the name: the control surface, and no edge.
  headingInput: {
    paddingVertical: 2,
    paddingHorizontal: space.sm,
    borderRadius: 12,
    backgroundColor: theme.colors.surface2,
  },
  description: { color: theme.colors.textSecondary, fontSize: 13, lineHeight: 18 },
  descriptionInput: {
    paddingVertical: 5,
    paddingHorizontal: space.sm,
    borderRadius: 12,
    backgroundColor: theme.colors.surface2,
  },
  meta: { color: theme.colors.textMuted, fontSize: 12.5 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  spacer: { flex: 1 },
  // Room between the menu's groups, where a line used to be.
  divider: { height: space.sm },
  spinner: { marginTop: space.xl },
  empty: {
    alignItems: 'center',
    gap: space.sm,
    paddingTop: 48,
    paddingHorizontal: space.lg,
  },
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
