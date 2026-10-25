import { memo, useCallback, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { ChromeSpacer } from '../../shell/ChromeSpacer'
import { Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import {
  plural,
  formatLongDuration,
  type ForgottenGems,
  type Playlist,
  type SharedSummary,
} from '@selfmp3/shared'
import {
  radius,
  space,
  type,
  useGems,
  useLibrary,
  usePlaylistSongs,
  iconSize,
} from '@selfmp3/client'
import { prefs } from '../../ports/prefs'
import { usePlayerCommands } from '../../player/PlayerProvider'
import { useLayout } from '../../shell/useLayout'
import { GridTile, TileGrid, useTileGrid, type TileFocus } from '../../ui/components/TileGrid'
import { useAccent } from '../../ui/accent'
import { tip } from '../../ui/tip'
import { Live, Play, Plus } from '../../ui/components/Icons'
import { Menu } from '../../ui/components/MoreMenu'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { Select } from '../../ui/components/Select'
import { floating, pageFrame } from '../../ui/surfaces'
import type { PopoverAnchor } from '../../ui/rightClick'
import { useSongsById } from '../../ui/songsById'
import { PageHeader } from '../../ui/components/PageHeader'
import { PageLoading } from '../../ui/components/PageLoading'
import { CantReach } from '../library/CantReach'
import { useSharedList } from '../shared/sharedPlaylists'
import { SharedTile } from '../shared/SharedScreens'
import { GEMS_SOURCE, tagsWithIds } from '../lists/lists.model'
import { followedTagIds } from '../playlistDetail/follows.model'
import { NewPlaylist } from './NewPlaylist'
import { DeletePlaylistDialog, usePlaylistMenu } from './playlistMenu'
import { PlaylistCover } from './PlaylistCover'
import {
  isLive,
  isPlaylistSort,
  FOLLOWS_LABEL,
  PLAYLIST_SORTS,
  playlistsSubline,
  playlistTileLine,
  usePlaylistsModel,
  type PlaylistSort,
} from './playlists.model'
import { usePlaylistPlayback } from './usePlaylistPlayback'
import { ScrollView } from '../../ui/components/Scroll'
import { Press } from '../../ui/components/Press'

/** Tiles at least this wide at desktop width, as many as fit; two across on a phone. */
const TILE_MIN_WIDTH = 176
const GAP = 14
/** The round play button over a tile's cover. */
const FAB = 38
const SORT_PREF = 'playlists.sort'

/**
 * Every playlist with a song in it, as tiles wearing their songs' covers
 * (docs/ui-mock `P16`, `C07`).
 *
 * In the order you last played them, so the ones in use are first without
 * pinning anything — there are no pins. A computer has A–Z and newest one
 * choice away, remembered; a phone has only the one order, as `P16` draws, so
 * a choice made on a computer cannot leave it sorted by a control it lacks.
 * Each tile says when it was last played, the day the order is by.
 *
 * An empty playlist is not listed: making one goes straight into picking its
 * songs, and it exists once it has one (`NewPlaylist`).
 */
export function PlaylistsScreen(): ReactNode {
  const router = useRouter()
  const { wide, finePointer } = useLayout()
  const [chosenSort, setSortState] = useState<PlaylistSort>(() => {
    const stored = prefs.get(SORT_PREF)
    return isPlaylistSort(stored) ? stored : 'recent'
  })
  const sort = wide ? chosenSort : 'recent'
  const model = usePlaylistsModel(sort)
  const [newOpen, setNewOpen] = useState(false)
  const { columns, tileWidth } = useTileGrid({ minTile: TILE_MIN_WIDTH, gap: GAP })

  const setSort = (next: PlaylistSort): void => {
    setSortState(next)
    prefs.set(SORT_PREF, next)
  }

  const { playlists } = model
  /*
   * One reading of the clock and one playback hook for the whole page, handed
   * to every tile: a tile that subscribed to the player itself would redraw
   * its four-cover mosaic on every pause. One reading per mount is enough:
   * the line it feeds is grained in days.
   */
  const now = useMemo(() => new Date(), [])
  const playback = usePlaylistPlayback()
  // What a playlist that fills itself fills from, by name, for its tile's line.
  const { data: library } = useLibrary()
  const tags = library?.tags
  const fillsFrom = useCallback(
    (playlist: Playlist): string[] =>
      playlist.kind === 'live'
        ? tagsWithIds(followedTagIds(playlist.rules), tags ?? []).map(tag => tag.name)
        : [],
    [tags],
  )
  const openPlaylist = useCallback(
    (playlist: Playlist) =>
      router.push({ pathname: '/playlists/[id]', params: { id: String(playlist.id) } }),
    [router],
  )
  // A tile's menu, at the tile or where it was right-clicked; and a delete it asked for.
  const menuAnchor = useRef<PopoverAnchor | null>(null)
  const [menuFor, setMenuFor] = useState<Playlist | null>(null)
  const [deleting, setDeleting] = useState<Playlist | null>(null)
  const openMenu = useCallback((playlist: Playlist, at: PopoverAnchor) => {
    menuAnchor.current = at
    setMenuFor(playlist)
  }, [])

  const { data: shared } = useSharedList()
  const gems = useGems(30)
  // One grid, in this order: the way in, the built-in list, the shared ones, then yours.
  const tiles: GridItem[] = [
    { kind: 'new' },
    // Hidden when there are none, or the server cannot say.
    ...(gems.data && !gems.isError && gems.data.songs.length > 0
      ? [{ kind: 'gems' as const, gems: gems.data }]
      : []),
    ...(shared ?? []).map(item => ({ kind: 'shared' as const, item })),
    ...playlists.map(playlist => ({ kind: 'playlist' as const, playlist })),
  ]
  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={[styles.content, wide && styles.contentWide]}>
        <PageHeader
          title="Playlists"
          subtitle={
            model.loading
              ? 'Loading…'
              : model.unreachable
                ? 'Not loaded'
                : playlists.length === 0
                  ? 'None of your own yet'
                  : playlistsSubline(playlists.length)
          }
          style={styles.head}
          actions={
            // The order, on a computer. New is the grid's first tile (and the
            // sidebar's +), not a header button as well (I1, 2026-10-25).
            wide ? (
              <Select
                size="small"
                value={sort}
                options={PLAYLIST_SORTS}
                onChange={setSort}
                label="Sort by"
                testID="playlists-sort"
              />
            ) : null
          }
        />

        {model.loading ? (
          <PageLoading />
        ) : model.unreachable ? (
          // Not "nothing of your own yet": nothing is known about them at all.
          <CantReach error={model.failure} onRetry={model.retry} />
        ) : (
          <TileGrid
            items={tiles}
            columns={columns}
            gap={GAP}
            keyOf={gridKey}
            renderItem={tile =>
              tile.kind === 'new' ? (
                <NewTile onPress={() => setNewOpen(true)} />
              ) : tile.kind === 'gems' ? (
                // Built in, and not a playlist: nothing to delete or rename.
                <GemsTile gems={tile.gems} />
              ) : tile.kind === 'shared' ? (
                // Shared with friends (features/shared): kept by the doorman, not this library.
                <SharedTile playlist={tile.item} size={tileWidth || undefined} />
              ) : (
                <PlaylistTile
                  playlist={tile.playlist}
                  line={playlistTileLine(tile.playlist, now, fillsFrom(tile.playlist))}
                  index={playlists.indexOf(tile.playlist)}
                  width={tileWidth}
                  finePointer={finePointer}
                  onOpen={openPlaylist}
                  onPlay={playback.playById}
                  onMenu={openMenu}
                />
              )
            }
          />
        )}
        <ChromeSpacer />
      </ScrollView>

      <NewPlaylist open={newOpen} onClose={() => setNewOpen(false)} />
      <PlaylistTileMenu
        playlist={menuFor}
        anchorRef={menuAnchor}
        onClose={() => setMenuFor(null)}
        onDelete={setDeleting}
      />
      <DeletePlaylistDialog playlist={deleting} onClose={() => setDeleting(null)} />
    </SafeAreaView>
  )
}

/** What the grid holds: the way in, the built-in list, a shared playlist, or one of yours. */
type GridItem =
  | { kind: 'new' }
  | { kind: 'gems'; gems: ForgottenGems }
  | { kind: 'shared'; item: SharedSummary }
  | { kind: 'playlist'; playlist: Playlist }

function gridKey(tile: GridItem): string {
  if (tile.kind === 'shared') return `shared-${tile.item.id}`
  if (tile.kind === 'playlist') return `playlist-${tile.playlist.id}`
  return tile.kind
}

/**
 * The way into a new playlist, as the grid's first tile.
 *
 * The grid is where you look when you want a playlist, so it is where making
 * one belongs — and a grid that starts with it has a beginning whether you own
 * seven playlists or none. It is washed with the accent, so it reads as the
 * way in rather than as one more playlist with nothing in it yet, whose cover
 * is a plain tone.
 */
function NewTile({ onPress }: { onPress: () => void }): ReactNode {
  const accent = useAccent()
  return (
    <GridTile
      cover={
        <View style={[styles.newCover, { backgroundColor: accent.accentPill }]}>
          <Plus size={26} color={accent.accent} />
        </View>
      }
      title="New playlist"
      onPress={onPress}
      label="New playlist"
      testID="playlists-new-tile"
    />
  )
}

/**
 * Forgotten gems, as a built-in tile among the playlists. Pressing it starts
 * the list rather than opening a page: the list is different every time it is
 * asked for. The page leaves it out when there are none.
 */
function GemsTile({ gems }: { gems: ForgottenGems }): ReactNode {
  const player = usePlayerCommands()
  const ids = gems.songs.map(song => song.id)
  const duration = gems.songs.reduce((sum, song) => sum + song.duration, 0)
  return (
    <GridTile
      cover={
        <View>
          <PlaylistCover songIds={ids} />
          <View style={styles.badge}>
            <Text style={styles.badgeText}>Built in</Text>
          </View>
        </View>
      }
      title="Forgotten gems"
      sub={`${plural(gems.songs.length, 'song', 'songs')} · ${formatLongDuration(duration)}`}
      onPress={() => player.playFrom(ids, 0, { source: GEMS_SOURCE })}
      label="Play forgotten gems"
      caption={`Liked or well played, quiet for ${gems.minDays}+ days`}
    />
  )
}

/**
 * One playlist's tile. Memoised, and handed the page's own playback rather
 * than subscribing to the player itself: a tile that reads the player redraws
 * on every pause, and it draws a four-cover mosaic.
 *
 * With a mouse, Play waits on the cover for the pointer or Tab; a finger
 * opens the page.
 */
const PlaylistTile = memo(function PlaylistTile({
  playlist,
  line,
  index,
  width,
  finePointer,
  onOpen,
  onPlay,
  onMenu,
}: {
  playlist: Playlist
  /** "5 songs · yesterday". */
  line: string
  index: number
  /** The tile's width, where Play sits on its cover; 0 until the page's width is known. */
  width: number
  finePointer: boolean
  onOpen: (playlist: Playlist) => void
  onPlay: (playlistId: number) => void
  /** Its menu, the playlist page's ⋯: on a right-click, or a hold. */
  onMenu: (playlist: Playlist, at: PopoverAnchor) => void
}): ReactNode {
  const { theme } = useUnistyles()
  const live = isLive(playlist)
  return (
    <GridTile
      cover={
        <View>
          <PlaylistCover playlist={playlist} />
          {/* A round mark: the line under the name says what it fills from. */}
          {live ? (
            <View style={styles.fillsMark} accessibilityLabel={FOLLOWS_LABEL}>
              <Live size={iconSize.field} color={theme.colors.textPrimary} />
            </View>
          ) : null}
        </View>
      }
      title={playlist.name}
      sub={line}
      onPress={() => onOpen(playlist)}
      onMenu={at => onMenu(playlist, at)}
      label={playlist.name}
      hint={finePointer ? 'Right-click for more actions' : 'Hold for more actions'}
      testID={`playlist-row-${index}`}
      overlay={
        width > 0
          ? (focus: TileFocus) => (
              <Press
                onPress={() => onPlay(playlist.id)}
                {...focus}
                accessibilityRole="button"
                accessibilityLabel={`Play ${playlist.name}`}
                {...tip('Play')}
                wrap={[styles.fabPlace, { top: width - FAB - 8 }]}
                style={styles.fab}
              >
                <Play size={iconSize.button} color={theme.colors.onPrimary} />
              </Press>
            )
          : undefined
      }
    />
  )
})

/**
 * A playlist tile's menu: what the playlist's page offers from its ⋯, but
 * Select songs, which needs the page's list. Rename and a description go to
 * the page, where the name and the description are edited in place. Kept
 * mounted, with the last playlist it was for, so it closes as it opened.
 */
function PlaylistTileMenu({
  playlist,
  anchorRef,
  onClose,
  onDelete,
}: {
  playlist: Playlist | null
  anchorRef: RefObject<PopoverAnchor | null>
  onClose: () => void
  onDelete: (playlist: Playlist) => void
}): ReactNode {
  const router = useRouter()
  const [shown, setShown] = useState(playlist)
  if (playlist !== null && playlist !== shown) setShown(playlist)
  // As the page lists them: the songs this device's library knows.
  const contents = usePlaylistSongs(shown?.id ?? null)
  const byId = useSongsById()
  const songIds = useMemo(
    () => contents.data?.songIds.filter(id => byId.has(id)),
    [contents.data, byId],
  )
  const toPage = (params: { rename?: string; describe?: string }): void => {
    if (!shown) return
    router.push({ pathname: '/playlists/[id]', params: { id: String(shown.id), ...params } })
  }
  const items = usePlaylistMenu(shown, songIds, {
    onRename: () => toPage({ rename: '1' }),
    onDescribe: () => toPage({ describe: '1' }),
    onDelete: () => {
      if (shown) onDelete(shown)
    },
  })
  return (
    <Menu
      open={playlist !== null}
      onClose={onClose}
      anchorRef={anchorRef}
      items={items}
      title={shown?.name}
      align="start"
      testID="playlist-tile-menu"
    />
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  content: { ...pageFrame(false), paddingBottom: space.xl },
  contentWide: pageFrame(true),
  head: { paddingBottom: space.lg },
  newCover: {
    aspectRatio: 1,
    borderRadius: radius.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 7,
    left: 7,
    paddingVertical: 2,
    paddingHorizontal: 7,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.glass,
  },
  fillsMark: {
    position: 'absolute',
    top: 8,
    left: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.glass,
  },
  badgeText: { color: theme.colors.textPrimary, fontSize: type.tiny, fontWeight: '700' },
  fabPlace: { position: 'absolute', right: 8 },
  fab: {
    width: FAB,
    height: FAB,
    borderRadius: FAB / 2,
    alignItems: 'center',
    justifyContent: 'center',
    // The white Play (`S2`), shown on one tile at a time as the pointer finds it.
    backgroundColor: theme.colors.textPrimary,
    ...floating(theme.colors),
  },
}))
