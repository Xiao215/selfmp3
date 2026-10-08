import { useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { plural, formatBytes, type Song } from '@selfmp3/shared'
import {
  bytesToDownload,
  failureText,
  space,
  useDeletePlaylist,
  useLibrary,
  useManifest,
  usePlaylistSongs,
  useReorderPlaylist,
  useUpdatePlaylist,
  useCreatePlaylist,
} from '@selfmp3/client'
import { useDownloads } from '../../offline/DownloadsProvider'
import { useDownloadRemoval } from '../../offline/useDownloadRemoval'
import { useArt } from '../../offline/useArt'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { usePlayerCommands } from '../../player/PlayerProvider'
import { useSelection } from '../../selection/useSelection'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../../ui/accent'
import { showToast } from '../../ui/toast'
import { tip } from '../../ui/tip'
import { useSongsById } from '../../ui/songsById'
import { useSongColor } from '../../ui/useSongColor'
import { Button, PlayButton } from '../../ui/components/Button'
import { ConfirmDialog } from '../../ui/components/ConfirmDialog'
import { IconButton } from '../../ui/components/IconButton'
import { ListHead, listHeadText } from '../../ui/components/ListHead'
import {
  CheckSquare,
  ChevronLeft,
  CloudDownload,
  Copy,
  Downloaded,
  ListMusic,
  Live,
  More,
  Next,
  Pencil,
  Play,
  Plus,
  QueueAdd,
  Shuffle,
  Trash,
} from '../../ui/components/Icons'
import { Popover } from '../../ui/components/Popover'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { SheetItem } from '../../ui/components/Sheet'
import { useListSelectionBar } from '../../ui/components/useListSelectionBar'
import { OrderedSongList } from '../../ui/components/OrderedSongList'
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
import { usePageBack } from '../../ui/useBackTo'

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
  const artFor = useArt(ROW_COVER_SIZE)
  const accent = useAccent()
  const { wide, finePointer } = useLayout()
  const params = useLocalSearchParams<{ id: string; rename?: string }>()
  const playlistId = Number(params.id)
  const router = useRouter()
  // Back to wherever it was opened from; Playlists only after a link (J1).
  const page = usePageBack('/playlists')
  const { mutateAsync: createPlaylist } = useCreatePlaylist()

  const library = useLibrary()
  const manifest = useManifest()
  const contents = usePlaylistSongs(Number.isInteger(playlistId) ? playlistId : null)
  const pull = usePullToRefresh(contents.refetch)
  const player = usePlayerCommands()
  const playback = usePlaylistPlayback()
  const updatePlaylist = useUpdatePlaylist()
  const deletePlaylist = useDeletePlaylist()
  const reorderPlaylist = useReorderPlaylist()
  const { state: downloads, installed, downloadByHand, removing } = useDownloads()
  // Taking the playlist's songs off this device can be undone, as one song's can.
  const removeDownloads = useDownloadRemoval()

  const [headMenuOpen, setHeadMenuOpen] = useState(false)
  const headMenuRef = useRef<View>(null)
  const [renaming, setRenaming] = useState(params.rename === '1')
  const [draftName, setDraftName] = useState<string | null>(null)
  const [describing, setDescribing] = useState(false)
  const [draftDescription, setDraftDescription] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [adding, setAdding] = useState(false)
  const playlist = library.data?.playlists.find(entry => entry.id === playlistId) ?? null
  const live = playlist !== null && isLive(playlist)
  const manual = playlist?.kind === 'manual'
  const tags = useMemo(() => library.data?.tags ?? [], [library.data])

  const byId = useSongsById()
  const songs = useMemo(
    () =>
      (contents.data?.songIds ?? [])
        .map(id => byId.get(id))
        .filter((song): song is Song => song !== undefined),
    [byId, contents.data],
  )
  const songIds = useMemo(() => songs.map(song => song.id), [songs])
  const inPlaylist = useMemo(() => new Set(songIds), [songIds])
  // The page is lit by the first cover it has, as a tag's page is.
  const lead = useMemo(() => songs.find(song => song.hasArt) ?? songs[0] ?? null, [songs])
  const leadArt = lead ? artFor(lead) : null
  const light = useSongColor(lead, leadArt)

  const selection = useSelection(songIds)
  /*
   * The selection bar takes a lane above the songs, so it covers none of them.
   * Left mounted while there is a playlist at all and told whether it belongs
   * on screen, rather than drawn and cut: a bar cut away the moment Done is
   * pressed has no chance to sink back, and it takes itself down once it has.
   */
  const bar = useListSelectionBar({
    songs,
    selection,
    scope: 'in this playlist',
    wide,
    // A live playlist has no membership to edit, so removing from it would be a lie.
    playlist: playlist && manual ? { id: playlist.id, name: playlist.name } : undefined,
  })

  const pendingBytes = manifest.data ? bytesToDownload(downloads.index, manifest.data, songIds) : 0
  // A string of its own rather than a read off `playlist`: the rows' memo
  // depends on it, and the compiler cannot vouch for a value that still points
  // into an object handed to the mutations below.
  const name = `${playlist?.name ?? 'Playlist'}`

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
      const created = await createPlaylist({ input, songIds: kind === 'manual' ? songIds : [] })
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
  const menuIcon = (Glyph: typeof QueueAdd, color = theme.colors.textSecondary): ReactNode => (
    <Glyph size={16} color={color} />
  )

  const titles = (
    <>
      <View style={listHeadText.kind}>
        {live ? <Live size={12} tone="textSecondary" /> : null}
        <Text style={listHeadText.kindText}>
          {live ? `Playlist · ${FOLLOWS_LABEL}` : 'Playlist'}
        </Text>
      </View>
      {renaming ? (
        <TextInput
          style={[listHeadText.name, wide && styles.nameWide, styles.nameInput]}
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
          <Text style={[listHeadText.name, wide && styles.nameWide]} numberOfLines={2}>
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
      <Text style={listHeadText.summary}>
        {playlistHeadLine(count, seconds, playlist?.lastPlayedAt ?? null, new Date())}
      </Text>
    </>
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
      <ListHead
        wide={wide}
        light={light.color}
        art={leadArt}
        topBar={
          wide ? (
            // A computer's ⋯ is with the actions; its ‹ only for a playlist
            // opened from inside a page, not from the sidebar.
            page.shown ? (
              <IconButton label="Back" onPress={page.back} filled>
                <ChevronLeft size={20} tone="textPrimary" />
              </IconButton>
            ) : null
          ) : (
            <>
              <IconButton label="Back" onPress={page.back} filled>
                <ChevronLeft size={20} tone="textPrimary" />
              </IconButton>
              {moreButton}
            </>
          )
        }
        cover={
          <PlaylistCover
            playlist={playlist}
            songIds={contents.data?.songIds}
            size={wide ? 176 : 168}
          />
        }
        titles={titles}
        actions={
          <>
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
          </>
        }
        wideOverrides={WIDE}
      />
      {playlist.kind === 'live' ? (
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
        <View style={styles.listArea}>
          {playlist ? bar.floating : null}

          <OrderedSongList
            songs={songs}
            label={`${name} songs`}
            selection={selection}
            onPlay={index => playback.playFrom(playlistId, songIds, index)}
            // One that fills from tags is in its rule's order, not yours.
            onReorder={
              manual
                ? moved => reorderPlaylist.mutate({ playlistId, songIds: [...moved] })
                : undefined
            }
            header={header}
            pinned={playlist ? bar.pinned : null}
            empty={empty}
            style={styles.scroll}
            contentContainerStyle={[styles.content, bar.listPadding]}
            keyboardShouldPersistTaps="handled"
            // A name or a description being typed in the head stays open through a scroll.
            keyboardDismissMode="none"
            onRefresh={pull.onRefresh}
            refreshing={pull.refreshing}
            menuPlaylist={manual && playlist ? { id: playlist.id, name: playlist.name } : undefined}
          />
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
        {/*
         * Holding a row here moves it (D1), so selecting starts here: on a
         * phone this is the way to the bulk actions — remove, tag, download.
         */}
        <SheetItem
          icon={menuIcon(CheckSquare)}
          label="Select songs"
          disabled={nothing}
          onPress={menuAction(() => selection.enter())}
        />
        <SheetItem
          icon={menuIcon(Next)}
          label="Play next"
          disabled={nothing}
          onPress={menuAction(() => player.playNext(songIds))}
        />
        <SheetItem
          icon={menuIcon(QueueAdd)}
          label="Add to Up next"
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
              onPress={menuAction(() => removeDownloads(songIds))}
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

      {manual && playlist ? (
        <AddSongsSheet
          open={adding}
          onClose={() => setAdding(false)}
          targetName={playlist.name}
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

/**
 * A playlist's head on a computer keeps the hero on one row, its buttons
 * straight after the words rather than pushed to the far end.
 */
const WIDE = {
  hero: { flexWrap: 'nowrap', gap: 24 },
  titles: { flexBasis: 'auto' },
  actions: { marginLeft: 0 },
} as const

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
