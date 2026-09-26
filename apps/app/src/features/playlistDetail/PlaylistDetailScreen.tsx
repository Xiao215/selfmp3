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
import { ActivityIndicator, Animated, Pressable, Text, TextInput, View } from 'react-native'
import type { FlatListProps, GestureResponderEvent } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import { plural, formatBytes, type Song } from '@selfmp3/shared'
import {
  bytesToDownload,
  clientApi,
  failureText,
  fonts,
  isDownloaded,
  queryKeys,
  radius,
  space,
  useDeletePlaylist,
  useLibrary,
  useManifest,
  usePlaylistSongs,
  useReorderPlaylist,
  useUpdatePlaylist,
} from '@selfmp3/client'
import { useDownloads } from '../../offline/DownloadsProvider'
import { useArt } from '../../offline/useArt'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { usePlayer } from '../../player/PlayerProvider'
import { HoldToReorder, useLiftScale, useMakeRoom } from '../../ui/components/HoldToReorder'
import { roomShift } from '../../ui/motion.model'
import { modifiersOf, useSelection } from '../../selection/useSelection'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../../ui/accent'
import { showToast } from '../../ui/toast'
import { artShadow, label as labelText } from '../../ui/surfaces'
import { tip } from '../../ui/tip'
import { useSongColor } from '../../ui/useSongColor'
import { Button, PlayButton } from '../../ui/components/Button'
import { ConfirmDialog } from '../../ui/components/ConfirmDialog'
import { CoverLight } from '../../ui/components/CoverLight'
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
  Play,
  Plus,
  Queue,
  Shuffle,
  Trash,
} from '../../ui/components/Icons'
import { Popover } from '../../ui/components/Popover'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { SELECTION_BAR_SPACE, SelectionBar } from '../../ui/components/SelectionBar'
import { SheetItem } from '../../ui/components/Sheet'
import { SongList } from '../../ui/components/SongList'
import { SongMenu } from '../../ui/components/SongMenu'
import { SongRow } from '../../ui/components/SongRow'
import { usePullToRefresh } from '../library/usePullToRefresh'
import { PlaylistCover } from '../playlists/PlaylistCover'
import {
  copyName,
  FOLLOWS_LABEL,
  isLive,
  newPlaylist,
  playlistHeadLine,
} from '../playlists/playlists.model'
import { usePlaylistPlayback } from '../playlists/usePlaylistPlayback'
import { AddSongsSheet } from './AddSongsSheet'
import { FollowsRow } from './FollowsRow'
import { cameFrom, dropIndex, movedTo } from './playlistDetail.model'

/**
 * One playlist (docs/ui-mock `P17`, `C08`): the same kind of page as a tag's
 * or an artist's (`PlacePage`).
 *
 * The head is lit by its covers, with the mosaic, a small PLAYLIST over the
 * name in the display face, and "5 songs · 18 min · played yesterday"; then
 * one loud button, Play, with Shuffle and Add songs beside it. A phone has a
 * round back and the ⋯ at the top; a computer has no back (the sidebar is
 * there) and puts the ⋯ at the end of the buttons, as `C08` draws. Everything
 * else a playlist can have done to it — queueing, downloading, renaming,
 * copying, deleting — waits in its ⋯, so none of it sits a thumb's width from
 * Play. An empty playlist shows none of Play, Shuffle or the head's Add songs,
 * which could only do nothing.
 *
 * Rows are the library's `SongRow` without tag chips: inside a playlist the
 * playlist is the context (`S3`). Any playlist moves its rows the same way,
 * by holding one until it lifts — a computer's mouse as much as a finger. One
 * that follows tags shows its tags as a row of chips above the songs, so what
 * it is picking stays what the page shows, and it takes a hand order too.
 *
 * Arriving with `?rename=1` puts the cursor in the name — where a playlist
 * just saved from a tag pick sends you when you press Rename on the message.
 */
export function PlaylistDetailScreen(): ReactNode {
  const { theme } = useUnistyles()
  // The head's light runs up behind the status bar rather than stopping at
  // it, so the page is lit to its own top edge; only what is read sits under.
  const { top } = useSafeAreaInsets()
  const artFor = useArt(ROW_COVER_SIZE)
  const accent = useAccent()
  const { wide, finePointer } = useLayout()
  const params = useLocalSearchParams<{ id: string; rename?: string }>()
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
  const { state: downloads, installed, downloadByHand, removeByHand, removing } = useDownloads()

  const [menuSong, setMenuSong] = useState<Song | null>(null)
  const menuAnchorRef = useRef<View | null>(null)
  const [headMenuOpen, setHeadMenuOpen] = useState(false)
  const headMenuRef = useRef<View>(null)
  const [renaming, setRenaming] = useState(params.rename === '1')
  const [draftName, setDraftName] = useState<string | null>(null)
  const [describing, setDescribing] = useState(false)
  const [draftDescription, setDraftDescription] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [adding, setAdding] = useState(false)
  // The row being moved and the row it would land on. Not how far it has
  // travelled: that is `dragY`, which moves the row without a render.
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null)
  const [dragY] = useState(() => new Animated.Value(0))
  /*
   * The scale the row being moved wears (`useLiftScale`): a swell while the
   * hold is counted, the full lift while it is carried, and the settle back on
   * the spring once it is let go. One scale for the page, worn by whichever
   * song is being moved — by song and not by row, since the drop reorders the
   * playlist under it and the settle plays on into the row's new place.
   */
  const lift = useLiftScale()
  // The three made-once callbacks on their own, so the handlers that use them
  // do not have to watch the whole thing: it is remade whenever the row wearing
  // the scale changes, and a row's memo has to hold through that.
  const { holding: holdRow, start: liftRow, drop: dropRow } = lift
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
  // The page is lit by the first cover it has, as a tag's page is.
  const lead = useMemo(() => songs.find(song => song.hasArt) ?? songs[0] ?? null, [songs])
  const leadArt = lead ? artFor(lead) : null
  const light = useSongColor(lead, leadArt)

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
  })
  useEffect(() => {
    latest.current = {
      songIds,
      rowHeight,
      selection,
      playback,
      playlistId,
      reorderPlaylist,
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
      liftRow(songId)
      setDrag({ from: index, over: index })
    },
    [dragY, liftRow],
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
  const dragEnd = useCallback(
    (songId: number, dy: number) => {
      const now = latest.current
      const index = now.songIds.indexOf(songId)
      if (index < 0) return
      const moved = movedTo(now.songIds, index, dy, now.rowHeight)
      // `dragY` is left where it is: the lift ends in the same render as the
      // move, and resetting it first would show the row back in its old place
      // for a frame. What covers that frame, and the commit after it, is the
      // settle: the row keeps wearing the lift and springs back to 1 wherever
      // the new order has put it.
      setDrag(null)
      dropRow()
      if (moved) {
        now.reorderPlaylist.mutate({ playlistId: now.playlistId, songIds: moved.songIds })
      }
    },
    [dropRow],
  )

  const rowActions = useMemo<RowActions>(
    () => ({
      dragStart,
      dragMove,
      dragEnd,
      holding: holdRow,
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
      // Holding a row is how it is moved, so holding to select is the menu's
      // job here (`SongMenu`). Where there is no order to change, holding
      // selects, exactly as it does in the library.
      longPress: song => latest.current.selection.enter(song.id),
      measure: setRowHeight,
    }),
    [dragStart, dragMove, dragEnd, holdRow],
  )

  /*
   * What every cell of the list needs to know about the move under way
   * (`LiftedCell`): which row is carried and how far it has travelled, which
   * rows are to step aside and by how much, and which row is wearing the lift.
   * The row wearing it is named by song, so the settle follows the song as the
   * new order lands; the cell only knows its place, so the place is worked out
   * here.
   */
  const liftedFrom = drag?.from ?? null
  const liftedOver = drag?.over ?? null
  const wearingAt = lift.wearing === null ? -1 : songIds.indexOf(lift.wearing)
  const settling = wearingAt < 0 ? null : wearingAt
  const carry = useMemo(
    () => ({
      from: liftedFrom,
      over: liftedOver,
      step: rowHeight,
      dragY,
      lift: lift.lift,
      settling,
    }),
    [liftedFrom, liftedOver, rowHeight, dragY, lift.lift, settling],
  )

  // Not on this phone and no server to stream it from: faded.
  const unreachableHere = library.isError && installed
  const menuSongId = menuSong?.id ?? null
  // Any playlist can be put in the order you like, one that follows tags
  // included: it keeps finding songs, and the ones it finds land after the
  // order you set (Xiao, 2026-09-21). Selection mode is not what reordering is
  // for, so a held row selects rather than lifts while it is on.
  const reorderable = !selection.active
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
          menuOpen={menuSongId === item.id}
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
      showToast(failureText(`Couldn’t copy “${playlist.name}”`, caught), 'error')
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

  const back = (): void => {
    // Back when the Playlists page is behind; after a playlist made from a
    // selection, or a link, Playlists takes this page's place instead.
    if (cameFrom(navigation.getState(), 'playlists/index')) router.back()
    else router.replace('/playlists')
  }

  const titles = (
    <View style={styles.titles}>
      <View style={styles.kind}>
        {live ? <Live size={12} tone="textSecondary" /> : null}
        <Text style={styles.kindText}>{live ? `Playlist · ${FOLLOWS_LABEL}` : 'Playlist'}</Text>
      </View>
      {renaming ? (
        <TextInput
          style={[styles.name, wide && styles.nameWide, styles.nameInput]}
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
          <Text style={[styles.name, wide && styles.nameWide]} numberOfLines={2}>
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
      <Text style={styles.summary}>
        {playlistHeadLine(count, seconds, playlist?.lastPlayedAt ?? null, new Date())}
      </Text>
    </View>
  )

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
        <More size={18} tone="textPrimary" />
      </IconButton>
    </View>
  )

  // Above the songs, and scrolled with them: the songs are a virtualised list
  // now — a live playlist with no rules is the whole library — and this is its
  // header rather than the top of a ScrollView drawing every row at once.
  const header = playlist ? (
    <View>
      <View style={[styles.head, wide && styles.headWide, { paddingTop: top + 8 }]}>
        <CoverLight color={light.color} art={leadArt} />
        {wide ? null : (
          <View style={styles.topBar}>
            <IconButton label="Back to playlists" onPress={back} filled>
              <ChevronLeft size={20} tone="textPrimary" />
            </IconButton>
            {moreButton}
          </View>
        )}
        <View style={[styles.hero, wide && styles.heroWide]}>
          <View style={styles.mosaic}>
            <PlaylistCover
              playlist={playlist}
              songIds={contents.data?.songIds}
              size={wide ? 176 : 168}
            />
          </View>
          {titles}
          <View style={[styles.actions, wide && styles.actionsWide]}>
            {emptyPlaylist ? null : (
              // The page's one white Play (`S2`).
              <PlayButton
                onPress={() => playback.play(playlistId, songIds)}
                disabled={nothing}
                label={`Play ${name}`}
                testID="playlist-play"
                icon={<Play size={24} color={theme.colors.onPrimary} />}
              />
            )}
            {emptyPlaylist ? null : (
              <Button
                label="Shuffle"
                accessibilityLabel={`Shuffle ${name}`}
                icon={<Shuffle size={16} tone="textPrimary" />}
                disabled={nothing}
                onPress={() => playback.shuffle(playlistId, songIds)}
              />
            )}
            {manual && !emptyPlaylist ? (
              <Button
                label="Add songs"
                icon={<Plus size={15} tone="textPrimary" />}
                onPress={() => setAdding(true)}
                testID="playlist-add-songs"
              />
            ) : null}
            {wide ? moreButton : null}
          </View>
        </View>
      </View>
      {live ? (
        <View style={styles.gutter}>
          <FollowsRow playlist={playlist} tags={tags} />
        </View>
      ) : null}
    </View>
  ) : (
    <View />
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
        {playlist ? `${plural(playlist.songCount, 'song is', 'songs are')} in here, ` : ''}
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
    <View style={styles.screen}>
      <View style={styles.split}>
        {/*
          The selection bar takes a lane above the songs, so it covers none of
          them. Left mounted while there is a playlist at all and told whether
          it belongs on screen, rather than drawn and cut: a bar cut away the
          moment Done is pressed has no chance to sink back, and it takes
          itself down once it has.
        */}
        <View style={styles.listArea}>
          {playlist ? (
            <SelectionBar
              shown={selection.active}
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

          <LiftContext.Provider value={carry}>
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
        {/*
         * Keeping this one playlist on the phone (Open question 5): here rather
         * than on the page, where it was a third button beside Play. Once every
         * song is here the same place takes it back off.
         */}
        {installed && !emptyPlaylist ? (
          pendingBytes > 0 ? (
            <SheetItem
              icon={menuIcon(CloudDownload)}
              label="Download"
              detail={formatBytes(pendingBytes)}
              onPress={menuAction(() => downloadByHand(songIds))}
            />
          ) : (
            <SheetItem
              icon={<Downloaded size={16} color={accent.accent} knockout={theme.colors.surface2} />}
              label="Remove download"
              detail="On this phone"
              disabled={removing}
              onPress={menuAction(() => void removeByHand(songIds))}
            />
          )
        ) : null}
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
        playlist={manual && playlist ? { id: playlist.id, name: playlist.name } : undefined}
      />

      {manual && playlist ? (
        <AddSongsSheet
          open={adding}
          onClose={() => setAdding(false)}
          playlistName={playlist.name}
          target={{ kind: 'existing', playlistId: playlist.id, inPlaylist }}
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
    </View>
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
  /** The hold has begun on a song, or it is over: the row's swell (`useLiftScale`). */
  readonly holding: (songId: number, holding: boolean) => void
  readonly press: (event: GestureResponderEvent, songId: number, index: number) => void
  readonly more: (anchor: View | null, song: Song) => void
  readonly toggleSelect: (song: Song) => void
  readonly longPress: (song: Song) => void
  readonly measure: (height: number) => void
}

/**
 * One track of a playlist: the library's row, with what a playlist adds.
 *
 * The row itself is `SongRow`, the same component and the same file the
 * library draws — a song row is a song row, and a playlist that had its own
 * was a playlist whose songs had no ⋯ at a finger's size and no colour under
 * the one that was playing. It is drawn without tag chips, as every row inside
 * a place is (`S3`). What a playlist adds is the hold that lifts a row and the
 * lifted look while it is being moved; where it would land is the gap the rows
 * around it open (`LiftedCell`), not a line drawn between two of them, which
 * is how the queue sheet and the rail say the same thing. Taking a song off the
 * playlist is in the ⋯ menu, where everything else done to a song already is.
 *
 * Only the handlers that need this row's place are made here — the press,
 * which plays from it, and the four that carry a move. The rest are the
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
  menuOpen,
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
  menuOpen: boolean
  actions: RowActions
}): ReactNode {
  const songId = song.id
  const onHolding = useCallback(
    (holding: boolean) => actions.holding(songId, holding),
    [actions, songId],
  )
  const onDragStart = useCallback(() => actions.dragStart(songId), [actions, songId])
  const onDragMove = useCallback((dy: number) => actions.dragMove(songId, dy), [actions, songId])
  const onDragEnd = useCallback((dy: number) => actions.dragEnd(songId, dy), [actions, songId])
  const onPress = useCallback(
    (event: GestureResponderEvent) => actions.press(event, songId, index),
    [actions, songId, index],
  )

  // One gesture, everywhere: hold the row and it lifts. The grip column that
  // used to stand in for it on a computer is gone — six dots on every row
  // read as clutter, and a mouse can hold a row as well as a finger can
  // (Xiao, 2026-09-21).
  const holds = reorderable

  return (
    <HoldToReorder
      enabled={holds}
      onHolding={onHolding}
      onStart={onDragStart}
      // A playlist's rows only ever move up and down.
      onMove={(_dx, dy) => onDragMove(dy)}
      onEnd={(_dx, dy) => onDragEnd(dy)}
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
        selecting={selecting}
        selected={selected}
        menuOpen={menuOpen}
        lifted={lifted}
        onPress={onPress}
        onMore={actions.more}
        onToggleSelect={actions.toggleSelect}
        // `null` while the hold is the move's: see `SongRow`.
        onLongPress={holds ? null : actions.longPress}
      />
    </HoldToReorder>
  )
})

/** The move under way, as every cell of the list needs it. */
interface Carry {
  /** The row being carried, if one is. */
  readonly from: number | null
  /** The row it would land on. */
  readonly over: number | null
  /** How tall a row is, which is how far a row steps when it makes room. */
  readonly step: number
  /** How far the carried row has travelled. */
  readonly dragY: Animated.Value | null
  /** The scale the row being moved wears (`useLiftScale`). */
  readonly lift: Animated.Value | null
  /** Which row is wearing that scale: held, carried, or settling after the drop. */
  readonly settling: number | null
}

const LiftContext = createContext<Carry>({
  from: null,
  over: null,
  step: 0,
  dragY: null,
  lift: null,
  settling: null,
})

type CellProps = ComponentProps<NonNullable<FlatListProps<Song>['CellRendererComponent']>>

/**
 * A list cell that takes part in a move: the carried one lifted over its
 * neighbours and following the pointer by an animated value rather than by
 * re-rendering, and every other one stepping aside to make room for it.
 *
 * On the cell rather than the row because a list puts each row in a cell of
 * its own, and on a phone a raised `zIndex` only counts among siblings — a
 * row raised inside its cell still slid under the next cell. Reads the move
 * from context, so this component stays the same one for the list's life and
 * starting a move does not remount every row, and its gesture with it.
 *
 * Make-room here is the same step the queue sheet's rows take (`useMakeRoom`),
 * so where the row will land is a gap and not a line — one reorder language on
 * every surface. A `FlatList` mounts and unmounts cells rather than recycling
 * them, so a cell's step is its own and a cell scrolled away and back simply
 * works its step out again.
 */
function LiftedCell({ index, style, onLayout, onFocusCapture, children }: CellProps): ReactNode {
  const { from, over, step, dragY, lift, settling } = useContext(LiftContext)
  const carried = dragY !== null && from === index
  const room = useMakeRoom(
    from === null || over === null || carried ? 0 : roomShift(index, from, over),
    step,
    from !== null,
  )
  return (
    <Animated.View
      style={[
        style,
        carried && lift !== null
          ? { zIndex: 2, transform: [{ translateY: dragY }, { scale: lift }] }
          : // Settling, or swelling while its hold is counted: the scale only.
            // `dragY` is left where the finger put it until the new order
            // lands, so a row reading it now would settle in the wrong place.
            settling === index && lift !== null
            ? { zIndex: 2, transform: [{ scale: lift }] }
            : room,
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
  // The light stays inside the head, so it never runs on under the rows.
  head: { paddingHorizontal: 20, paddingBottom: 16, gap: 18, overflow: 'hidden' },
  headWide: { paddingHorizontal: 40, paddingTop: 44 },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
  },
  hero: { gap: 16 },
  heroWide: { flexDirection: 'row', alignItems: 'flex-end', gap: 24 },
  mosaic: {
    alignSelf: 'flex-start',
    ...artShadow(theme.colors),
    borderRadius: radius.card,
  },
  titles: { gap: 6, flexShrink: 1, flexGrow: 1, minWidth: 0 },
  kind: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kindText: labelText(theme.colors),
  name: {
    color: theme.colors.textPrimary,
    fontFamily: fonts.display,
    fontSize: 40,
    lineHeight: 46,
    letterSpacing: -0.8,
  },
  nameWide: { fontSize: 56, lineHeight: 60, letterSpacing: -1.5 },
  // A field in place of the name: the control surface, and no edge.
  nameInput: {
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
  summary: { color: theme.colors.textSecondary, fontSize: 14 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  actionsWide: { paddingBottom: 6 },
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
