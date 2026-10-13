import { memo, useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
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
import { radius, space, type, useGems } from '@selfmp3/client'
import { prefs } from '../../ports/prefs'
import { usePlayerCommands } from '../../player/PlayerProvider'
import { useLayout } from '../../shell/useLayout'
import { GridTile, TileGrid, useTileGrid, type TileFocus } from '../../ui/components/TileGrid'
import { useAccent } from '../../ui/accent'
import { tip } from '../../ui/tip'
import { Button } from '../../ui/components/Button'
import { IconButton } from '../../ui/components/IconButton'
import { Live, Play, Plus } from '../../ui/components/Icons'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { Select } from '../../ui/components/Select'
import { floating, pageFrame } from '../../ui/surfaces'
import { PageHeader } from '../../ui/components/PageHeader'
import { PageLoading } from '../../ui/components/PageLoading'
import { CantReach } from '../library/CantReach'
import { useSharedList } from '../shared/sharedPlaylists'
import { SharedTile } from '../shared/SharedScreens'
import { GEMS_SOURCE } from '../lists/lists.model'
import { NewPlaylist } from './NewPlaylist'
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
  const { theme } = useUnistyles()
  const router = useRouter()
  const { wide } = useLayout()
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
  const openPlaylist = useCallback(
    (playlist: Playlist) =>
      router.push({ pathname: '/playlists/[id]', params: { id: String(playlist.id) } }),
    [router],
  )

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
                  : playlistsSubline(playlists.length, sort)
          }
          style={styles.head}
          actions={
            // A phone's New sits beside the name, as Library's buttons do; a
            // computer's goes at the far end with the order.
            wide ? (
              <>
                <Select
                  size="small"
                  value={sort}
                  options={PLAYLIST_SORTS}
                  onChange={setSort}
                  label="Sort by"
                  testID="playlists-sort"
                />
                {/* White, as `C07` draws it: `active` is the pill's white. */}
                <Button
                  label="New"
                  icon={<Plus size={15} color={theme.colors.onPrimary} />}
                  active
                  onPress={() => setNewOpen(true)}
                  testID="playlists-new"
                />
              </>
            ) : (
              <IconButton
                onPress={() => setNewOpen(true)}
                label="New playlist"
                filled
                active={newOpen}
                testID="playlists-new"
              >
                <Plus size={20} color={theme.colors.textPrimary} />
              </IconButton>
            )
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
                  line={playlistTileLine(tile.playlist, now)}
                  index={playlists.indexOf(tile.playlist)}
                  width={tileWidth}
                  onOpen={openPlaylist}
                  onPlay={playback.playById}
                />
              )
            }
          />
        )}
        <ChromeSpacer />
      </ScrollView>

      <NewPlaylist open={newOpen} onClose={() => setNewOpen(false)} />
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
  onOpen,
  onPlay,
}: {
  playlist: Playlist
  /** "5 songs · yesterday". */
  line: string
  index: number
  /** The tile's width, where Play sits on its cover; 0 until the page's width is known. */
  width: number
  onOpen: (playlist: Playlist) => void
  onPlay: (playlistId: number) => void
}): ReactNode {
  const { theme } = useUnistyles()
  const live = isLive(playlist)
  return (
    <GridTile
      cover={
        <View>
          <PlaylistCover playlist={playlist} />
          {live ? (
            <View style={[styles.badge, styles.badgeRow]}>
              <Live size={11} color={theme.colors.textPrimary} />
              <Text style={styles.badgeText}>{FOLLOWS_LABEL}</Text>
            </View>
          ) : null}
        </View>
      }
      title={playlist.name}
      sub={line}
      onPress={() => onOpen(playlist)}
      label={playlist.name}
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
                <Play size={15} color={theme.colors.onPrimary} />
              </Press>
            )
          : undefined
      }
    />
  )
})

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
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
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
