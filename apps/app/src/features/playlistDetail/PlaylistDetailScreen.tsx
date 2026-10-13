import { useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { plural, type Song, NameSchema } from '@selfmp3/shared'
import {
  failureText,
  space,
  useCreatePlaylist,
  useDeletePlaylist,
  useLibrary,
  usePlaylistSongs,
  useReorderPlaylist,
  useUpdatePlaylist,
  iconSize,
} from '@selfmp3/client'
import { useArt } from '../../offline/useArt'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { useSelection } from '../../selection/useSelection'
import { useLayout } from '../../shell/useLayout'
import { showToast } from '../../ui/toast'
import { tip } from '../../ui/tip'
import { useSongsById } from '../../ui/songsById'
import { useSongColor } from '../../ui/useSongColor'
import { Button } from '../../ui/components/Button'
import { ConfirmDialog } from '../../ui/components/ConfirmDialog'
import { EmptyState } from '../../ui/components/EmptyState'
import { BackButton } from '../../ui/components/BackButton'
import { MissingPage } from '../../ui/components/MissingPage'
import { PageLoading } from '../../ui/components/PageLoading'
import { ListHead, listHeadText } from '../../ui/components/ListHead'
import { Copy, ListMusic, Live, Pencil, Plus, Trash } from '../../ui/components/Icons'
import { MoreMenu } from '../../ui/components/MoreMenu'
import { PlayShuffle } from '../../ui/components/PlayShuffle'
import { useListActions } from '../../ui/components/useListActions'
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
import { lineSub } from '../../ui/surfaces'

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
 * just made from a selection sends you, with a name ready to type over.
 */
export function PlaylistDetailScreen(): ReactNode {
  const { theme } = useUnistyles()
  const artFor = useArt(ROW_COVER_SIZE)
  const { wide, finePointer } = useLayout()
  const params = useLocalSearchParams<{ id: string; rename?: string }>()
  const playlistId = Number(params.id)
  const router = useRouter()
  // Back to wherever it was opened from; Playlists only after a link (J1).
  const pageBackShown = usePageBack('/playlists').shown
  const { mutateAsync: createPlaylist } = useCreatePlaylist()

  const library = useLibrary()
  const contents = usePlaylistSongs(Number.isInteger(playlistId) ? playlistId : null)
  const pull = usePullToRefresh(contents.refetch)
  const playback = usePlaylistPlayback()
  const updatePlaylist = useUpdatePlaylist()
  const deletePlaylist = useDeletePlaylist()
  const reorderPlaylist = useReorderPlaylist()

  const heroRef = useRef<View>(null)
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
  const listActions = useListActions(songIds, { heroRef, selection })
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
      <MissingPage
        title="No such playlist"
        line="It may have been deleted, on this device or another."
        back="/playlists"
        action={{ label: 'All playlists', onPress: () => router.replace('/playlists') }}
      />
    )
  }

  const count = contents.data ? songs.length : (playlist?.songCount ?? 0)
  const seconds = contents.data
    ? songs.reduce((sum, song) => sum + song.duration, 0)
    : (playlist?.totalDuration ?? 0)
  // Known to be empty, not merely not loaded yet: Play, Shuffle and the head's
  // Add songs go, and the empty state's own Add songs is the one way in.
  const emptyPlaylist = count === 0

  const titles = (
    <>
      <View style={listHeadText.kind}>
        {live ? <Live size={iconSize.small} tone="textSecondary" /> : null}
        <Text style={listHeadText.kindText}>
          {live ? `Playlist · ${FOLLOWS_LABEL}` : 'Playlist'}
        </Text>
      </View>
      {renaming ? (
        <TextInput
          style={[listHeadText.name, styles.nameInput]}
          value={draftName ?? playlist?.name ?? ''}
          onChangeText={setDraftName}
          onSubmitEditing={saveName}
          onBlur={saveName}
          selectTextOnFocus
          autoFocus
          maxLength={NameSchema.maxLength ?? undefined}
          accessibilityLabel="Playlist name"
        />
      ) : (
        <Pressable
          onPress={() => setRenaming(true)}
          disabled={!finePointer || !playlist}
          accessibilityRole="header"
          {...(finePointer ? tip('Rename') : {})}
        >
          <Text style={listHeadText.name} numberOfLines={2}>
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

  /*
   * What every list's ⋯ offers — on a phone the way to the bulk actions, since
   * holding a row here moves it (D1) — then what a playlist adds. Everything
   * a playlist can have done to it waits here, so none of it sits a thumb's
   * width from Play.
   */
  const moreButton = (
    <MoreMenu
      name={name}
      title={name}
      caption="More"
      align="start"
      testID="playlist-more"
      menuTestID="playlist-menu"
      items={[
        ...listActions,
        ...(live
          ? [
              {
                key: 'save-copy',
                label: 'Save a copy as playlist',
                icon: <Copy size={iconSize.item} tone="textSecondary" />,
                disabled: songs.length === 0,
                apart: true,
                onPress: () => void makeCopy('manual'),
              },
            ]
          : []),
        {
          key: 'rename',
          label: 'Rename',
          icon: <Pencil size={iconSize.item} tone="textSecondary" />,
          apart: !live,
          onPress: () => setRenaming(true),
        },
        {
          key: 'describe',
          label: playlist?.description ? 'Edit description' : 'Add a description',
          icon: <Pencil size={iconSize.item} tone="textSecondary" />,
          onPress: () => setDescribing(true),
        },
        {
          key: 'duplicate',
          label: 'Duplicate',
          icon: <Copy size={iconSize.item} tone="textSecondary" />,
          onPress: () => void makeCopy(live ? 'live' : 'manual'),
        },
        {
          key: 'delete',
          label: 'Delete playlist…',
          icon: <Trash size={iconSize.item} tone="danger" />,
          danger: true,
          apart: true,
          onPress: () => setConfirmingDelete(true),
        },
      ]}
    />
  )

  // Above the songs, and scrolled with them: the songs are a virtualised list
  // — a live playlist with no rules is the whole library — and this is its
  // header rather than the top of a ScrollView drawing every row at once.
  const header = playlist ? (
    <View>
      <ListHead
        wide={wide}
        light={light.color}
        art={leadArt}
        heroRef={heroRef}
        topBar={
          // A computer's ⋯ is with the actions; its ‹ only for a playlist
          // opened from inside a page, not from the sidebar.
          wide ? (
            pageBackShown ? (
              <BackButton to="/playlists" />
            ) : null
          ) : (
            <>
              <BackButton to="/playlists" />
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
            <PlayShuffle
              name={name}
              songIds={songIds}
              empty={emptyPlaylist}
              heroRef={heroRef}
              onPlay={() => playback.play(playlistId, songIds)}
              onShuffle={() => playback.shuffle(playlistId, songIds)}
              testPrefix="playlist"
            />
            {manual && !emptyPlaylist ? (
              <Button
                label="Add songs"
                icon={<Plus tone="textPrimary" />}
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
    <PageLoading />
  ) : contents.isError ? (
    // The list is the server's; the library knows only how long it is.
    <EmptyState
      title="Can’t reach your library"
      line={`${
        playlist ? `${plural(playlist.songCount, 'song is', 'songs are')} in here, ` : ''
      }but the list itself can’t be loaded right now.`}
    >
      <Button label="Try again" onPress={() => void contents.refetch()} />
    </EmptyState>
  ) : (
    <EmptyState
      icon={
        live ? (
          <Live size={30} color={theme.colors.textMuted} />
        ) : (
          <ListMusic size={30} color={theme.colors.textMuted} />
        )
      }
      title={live ? 'No songs have these tags yet' : 'Nothing here yet'}
      line={
        live
          ? 'Tag a few songs, or change the tags it follows above, and they appear here.'
          : 'Search your library and add as many songs as you like.'
      }
    >
      {/* A live playlist fills from its tags, in the row above. */}
      {live ? null : (
        <Button
          label="Add songs"
          icon={<Plus color={theme.colors.textPrimary} />}
          onPress={() => setAdding(true)}
        />
      )}
    </EmptyState>
  )

  return (
    <View style={styles.screen}>
      <View style={styles.split}>
        <View style={styles.listArea}>
          {playlist ? bar.beforeList : null}

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
            // A name or a description being typed in the head stays open through a scroll.
            keyboardDismissMode="none"
            onRefresh={pull.onRefresh}
            refreshing={pull.refreshing}
            menuPlaylist={manual && playlist ? { id: playlist.id, name: playlist.name } : undefined}
          />
        </View>
      </View>

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
  // do, and an extra 16 here would sit the same row in a different place on
  // this page. The head and the empty state take it themselves.
  content: { paddingBottom: space.xl },
  gutter: { paddingHorizontal: space.lg },
  // A field in place of the name: the control surface, and no edge.
  nameInput: {
    paddingVertical: 2,
    paddingHorizontal: space.sm,
    borderRadius: 12,
    backgroundColor: theme.colors.surface2,
  },
  description: lineSub(theme.colors),
  descriptionInput: {
    paddingVertical: 5,
    paddingHorizontal: space.sm,
    borderRadius: 12,
    backgroundColor: theme.colors.surface2,
  },
}))
