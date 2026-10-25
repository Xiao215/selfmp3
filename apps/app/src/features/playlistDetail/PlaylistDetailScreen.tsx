import { useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- the name and the description are edited in place, in the head's own type
import { Text, TextInput, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { plural, type Song, NameSchema } from '@selfmp3/shared'
import {
  space,
  useLibrary,
  usePlaylistSongs,
  useReorderPlaylist,
  useUpdatePlaylist,
  iconSize,
  radius,
} from '@selfmp3/client'
import { useArt } from '../../offline/useArt'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { useSelection } from '../../selection/useSelection'
import { useLayout } from '../../shell/useLayout'
import { tip } from '../../ui/tip'
import { useSongsById } from '../../ui/songsById'
import { useSongColor } from '../../ui/useSongColor'
import { Button } from '../../ui/components/Button'
import { EmptyState } from '../../ui/components/EmptyState'
import { BackButton } from '../../ui/components/BackButton'
import { MissingPage } from '../../ui/components/MissingPage'
import { PageLoading } from '../../ui/components/PageLoading'
import { ListHead, listHeadText } from '../../ui/components/ListHead'
import { ListMusic, Live, Plus } from '../../ui/components/Icons'
import { MoreMenu } from '../../ui/components/MoreMenu'
import { PlayShuffle } from '../../ui/components/PlayShuffle'
import { useListSelectionBar } from '../../ui/components/useListSelectionBar'
import { OrderedSongList } from '../../ui/components/OrderedSongList'
import { usePullToRefresh } from '../library/usePullToRefresh'
import { PlaylistCover } from '../playlists/PlaylistCover'
import { FOLLOWS_LABEL, isLive, playlistHeadLine } from '../playlists/playlists.model'
import { DeletePlaylistDialog, usePlaylistMenu } from '../playlists/playlistMenu'
import { usePlaylistPlayback } from '../playlists/usePlaylistPlayback'
import { AddSongsSheet } from './AddSongsSheet'
import { FollowsRow } from './FollowsRow'
import { usePageBack } from '../../ui/useBackTo'
import { Press } from '../../ui/components/Press'
import { lineSub } from '../../ui/surfaces'
import { NO_AUTOFILL } from '../../ui/noAutofill'

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
 * just made from a selection sends you, with a name ready to type over — and
 * `?describe=1` in the description: Rename and a description from a tile's
 * menu on Playlists come here for them.
 */
export function PlaylistDetailScreen(): ReactNode {
  const { theme } = useUnistyles()
  const artFor = useArt(ROW_COVER_SIZE)
  const { wide, finePointer } = useLayout()
  const params = useLocalSearchParams<{ id: string; rename?: string; describe?: string }>()
  const playlistId = Number(params.id)
  const router = useRouter()
  // Back to wherever it was opened from; Playlists only after a link (J1).
  const pageBackShown = usePageBack('/playlists').shown

  const library = useLibrary()
  const contents = usePlaylistSongs(Number.isInteger(playlistId) ? playlistId : null)
  const pull = usePullToRefresh(contents.refetch)
  const playback = usePlaylistPlayback()
  const updatePlaylist = useUpdatePlaylist()
  const reorderPlaylist = useReorderPlaylist()

  const heroRef = useRef<View>(null)
  const [renaming, setRenaming] = useState(params.rename === '1')
  const [draftName, setDraftName] = useState<string | null>(null)
  const [describing, setDescribing] = useState(params.describe === '1')
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
  const menuItems = usePlaylistMenu(playlist, contents.data ? songIds : undefined, {
    heroRef,
    selection,
    onRename: () => setRenaming(true),
    onDescribe: () => setDescribing(true),
    onDelete: () => setConfirmingDelete(true),
  })
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
      {/* No PLAYLIST over the name; one that fills itself wears the mark by it. */}
      <View style={listHeadText.nameRow}>
        {live ? (
          <View accessibilityLabel={FOLLOWS_LABEL} {...tip(FOLLOWS_LABEL)}>
            <Live size={iconSize.large} tone="textSecondary" />
          </View>
        ) : null}
        {renaming ? (
          <TextInput
            {...NO_AUTOFILL}
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
          <Press
            feedback="dim"
            style={listHeadText.nameShrink}
            onPress={() => setRenaming(true)}
            disabled={!finePointer || !playlist}
            accessibilityRole="header"
            {...(finePointer ? tip('Rename') : {})}
          >
            <Text style={listHeadText.name} numberOfLines={2}>
              {name}
            </Text>
          </Press>
        )}
      </View>
      {describing ? (
        <TextInput
          {...NO_AUTOFILL}
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
      items={menuItems}
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
          // The ⋯ in the corner, as on a tag's, an artist's and a combined
          // page (P11 A); a computer's ‹ only for a playlist opened from
          // inside a page, not from the sidebar.
          <>
            {!wide || pageBackShown ? <BackButton to="/playlists" /> : <View />}
            {moreButton}
          </>
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
          <Live size={iconSize.large} color={theme.colors.textMuted} />
        ) : (
          <ListMusic size={iconSize.large} color={theme.colors.textMuted} />
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

      <DeletePlaylistDialog
        playlist={confirmingDelete ? playlist : null}
        onClose={() => setConfirmingDelete(false)}
        onDeleted={() => router.replace('/playlists')}
      />
    </View>
  )
}

/**
 * A playlist's head on a computer keeps its buttons straight after the words
 * rather than pushed to the far end. Where the row cannot hold the name at a
 * readable width beside them (a narrow window, or Up next open on a laptop),
 * the buttons go under it instead: held on one row, the name was squeezed to
 * nothing and the ⋯ went past the window's edge.
 */
const WIDE = {
  hero: { flexWrap: 'wrap', gap: space.xl },
  titles: { flexBasis: 260 },
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
  // A field in place of the name: the control surface, and no edge. A field
  // draws its own line, so it takes none of the name's headroom (`heroTitle`).
  nameInput: {
    paddingTop: 2,
    paddingBottom: 2,
    marginTop: 0,
    paddingHorizontal: space.sm,
    borderRadius: radius.field,
    backgroundColor: theme.colors.surface2,
  },
  description: lineSub(theme.colors),
  descriptionInput: {
    paddingVertical: 5,
    paddingHorizontal: space.sm,
    borderRadius: radius.field,
    backgroundColor: theme.colors.surface2,
  },
}))
