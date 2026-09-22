import { memo, useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ChromeSpacer } from '../../shell/ChromeSpacer'
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native'
import type { LayoutChangeEvent } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { formatLongDuration, type Playlist } from '@selfmp3/shared'
import { radius, space, useGems } from '@selfmp3/client'
import { prefs } from '../../ports/prefs'
import { usePlayer } from '../../player/PlayerProvider'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../../ui/accent'
import { tip } from '../../ui/tip'
import { Button } from '../../ui/components/Button'
import { IconButton } from '../../ui/components/IconButton'
import { Live, Play, Plus } from '../../ui/components/Icons'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { Select } from '../../ui/components/Select'
import { floating, pageTitle } from '../../ui/surfaces'
import { CantReach } from '../library/CantReach'
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

/** Tiles at least this wide at desktop width, as many as fit; two across on a phone. */
const TILE_MIN_WIDTH = 176
const PHONE_COLUMNS = 2
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
  const accent = useAccent()
  const router = useRouter()
  // The app's own width, not the window's: an iPad in Split View is handed
  // half the screen and told about the whole of it (`shell/rootWidth.ts`).
  const { wide, width } = useLayout()
  const [chosenSort, setSortState] = useState<PlaylistSort>(() => {
    const stored = prefs.get(SORT_PREF)
    return isPlaylistSort(stored) ? stored : 'recent'
  })
  const sort = wide ? chosenSort : 'recent'
  const model = usePlaylistsModel(sort)
  const [newOpen, setNewOpen] = useState(false)
  const [gridWidth, setGridWidth] = useState(0)

  const setSort = (next: PlaylistSort): void => {
    setSortState(next)
    prefs.set(SORT_PREF, next)
  }

  const { playlists } = model
  const measured = wide ? gridWidth : width - space.lg * 2
  const columns = wide
    ? Math.max(PHONE_COLUMNS, Math.floor((measured + GAP) / (TILE_MIN_WIDTH + GAP)))
    : PHONE_COLUMNS
  const tileWidth =
    measured > 0 ? Math.floor((measured - GAP * (columns - 1)) / columns) : undefined
  /*
   * One reading of the clock and one playback hook for the whole page. Called
   * in each tile, `usePlaylistPlayback` subscribed every tile to the player,
   * so a pause redrew all of them and the four covers in each mosaic; and a
   * fresh `new Date()` made every tile's line a new string besides. One
   * reading per mount is enough: the line it feeds is grained in days.
   */
  const now = useMemo(() => new Date(), [])
  const playback = usePlaylistPlayback()
  const openPlaylist = useCallback(
    (playlist: Playlist) =>
      router.push({ pathname: '/playlists/[id]', params: { id: String(playlist.id) } }),
    [router],
  )

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.head}>
          <View style={styles.titles}>
            <Text style={styles.heading} accessibilityRole="header">
              Playlists
            </Text>
            <Text style={styles.sub}>
              {model.loading
                ? 'Loading…'
                : model.unreachable
                  ? 'Not loaded'
                  : playlists.length === 0
                    ? 'None of your own yet'
                    : playlistsSubline(playlists.length, sort)}
            </Text>
          </View>
          <View style={styles.headActions}>
            {wide ? (
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
            )}
          </View>
        </View>

        {model.loading ? (
          <ActivityIndicator style={styles.spinner} color={accent.accent} />
        ) : model.unreachable ? (
          // Not "nothing of your own yet": nothing is known about them at all.
          <CantReach onRetry={model.retry} />
        ) : (
          <View
            style={styles.grid}
            onLayout={(event: LayoutChangeEvent) => setGridWidth(event.nativeEvent.layout.width)}
          >
            <NewTile width={tileWidth} onPress={() => setNewOpen(true)} />
            {/* Built in, and not a playlist: nothing to delete or rename. */}
            <GemsTile width={tileWidth} />
            {playlists.map((playlist, index) => (
              <PlaylistTile
                key={playlist.id}
                playlist={playlist}
                line={playlistTileLine(playlist, now)}
                index={index}
                width={tileWidth}
                onOpen={openPlaylist}
                onPlay={playback.playById}
              />
            ))}
          </View>
        )}
        <ChromeSpacer />
      </ScrollView>

      <NewPlaylist open={newOpen} onClose={() => setNewOpen(false)} />
    </SafeAreaView>
  )
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
function NewTile({
  width,
  onPress,
}: {
  width: number | undefined
  onPress: () => void
}): ReactNode {
  const accent = useAccent()

  return (
    <View style={[styles.tile, width ? { width } : null]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="New playlist"
        {...tip('Pick the songs yourself, or fill it from tags')}
        testID="playlists-new-tile"
        style={({ pressed }) => pressed && styles.pressed}
      >
        <View style={[styles.newCover, { backgroundColor: accent.accentPill }]}>
          <Plus size={26} color={accent.accent} />
          <Text style={styles.newKinds} numberOfLines={1}>
            yours, or {FOLLOWS_LABEL}
          </Text>
        </View>
        <Text style={styles.tileName} numberOfLines={1}>
          New playlist
        </Text>
        <Text style={styles.tileSub} numberOfLines={1}>
          Pick songs, or let rules pick
        </Text>
      </Pressable>
    </View>
  )
}

/**
 * Forgotten gems, as a built-in tile among the playlists. Pressing it starts
 * the list rather than opening a page: the list is different every time it is
 * asked for. Hidden when there are none.
 */
function GemsTile({ width }: { width: number | undefined }): ReactNode {
  const gems = useGems(30)
  const player = usePlayer()

  const data = gems.data
  if (gems.isError || !data || data.songs.length === 0) return null
  const ids = data.songs.map(song => song.id)
  const duration = data.songs.reduce((sum, song) => sum + song.duration, 0)

  return (
    <View style={[styles.tile, width ? { width } : null]}>
      <Pressable
        onPress={() => player.playFrom(ids, 0)}
        accessibilityRole="button"
        accessibilityLabel="Play forgotten gems"
        {...tip(`Loved or well played, quiet for ${data.minDays}+ days`)}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <View>
          <PlaylistCover songIds={ids} />
          <View style={styles.badge}>
            <Text style={styles.badgeText}>Built in</Text>
          </View>
        </View>
        <Text style={styles.tileName} numberOfLines={1}>
          Forgotten gems
        </Text>
        <Text style={styles.tileSub} numberOfLines={1}>
          {data.songs.length} songs · {formatLongDuration(duration)}
        </Text>
      </Pressable>
    </View>
  )
}

/**
 * One playlist's tile. Memoised, and handed the page's own playback rather
 * than subscribing to the player itself: a tile that reads the player redraws
 * on every pause, and it draws a four-cover mosaic.
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
  width: number | undefined
  onOpen: (playlist: Playlist) => void
  onPlay: (playlistId: number) => void
}): ReactNode {
  const { theme } = useUnistyles()
  const { finePointer } = useLayout()
  const [hovered, setHovered] = useState(false)
  const live = isLive(playlist)
  // With a mouse the play button waits for the pointer; a finger opens the page.
  const showPlay = finePointer && hovered && width !== undefined

  return (
    <View
      style={[styles.tile, width ? { width } : null]}
      onPointerEnter={finePointer ? () => setHovered(true) : undefined}
      onPointerLeave={finePointer ? () => setHovered(false) : undefined}
    >
      <Pressable
        testID={`playlist-row-${index}`}
        onPress={() => onOpen(playlist)}
        accessibilityRole="button"
        accessibilityLabel={playlist.name}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <View>
          <PlaylistCover playlist={playlist} />
          {live ? (
            <View style={[styles.badge, styles.badgeRow]}>
              <Live size={11} color={theme.colors.textPrimary} />
              <Text style={styles.badgeText}>{FOLLOWS_LABEL}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.tileName} numberOfLines={1}>
          {playlist.name}
        </Text>
        <Text style={styles.tileSub} numberOfLines={1}>
          {line}
        </Text>
      </Pressable>

      {showPlay ? (
        <Pressable
          onPress={() => onPlay(playlist.id)}
          accessibilityRole="button"
          accessibilityLabel={`Play ${playlist.name}`}
          {...tip('Play')}
          style={({ pressed }) => [
            styles.fab,
            { top: width - FAB - 8 },
            pressed && styles.fabPressed,
          ]}
        >
          <Play size={15} color={theme.colors.onPrimary} />
        </Pressable>
      ) : null}
    </View>
  )
})

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xl },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: space.md,
    paddingTop: 18,
    paddingBottom: space.lg,
  },
  titles: { flexShrink: 1, minWidth: 0 },
  heading: pageTitle(theme.colors),
  sub: { color: theme.colors.textMuted, fontSize: 13, marginTop: 3 },
  headActions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  tile: { width: '100%' },
  newCover: {
    aspectRatio: 1,
    borderRadius: radius.card,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: space.sm,
  },
  newKinds: { color: theme.colors.textSecondary, fontSize: 10.5 },
  pressed: { opacity: 0.75 },
  tileName: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
    marginTop: space.sm,
  },
  tileSub: { color: theme.colors.textMuted, fontSize: 12, marginTop: 1 },
  badge: {
    position: 'absolute',
    top: 7,
    left: 7,
    paddingVertical: 2,
    paddingHorizontal: 7,
    borderRadius: 999,
    backgroundColor: theme.colors.glass,
  },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  badgeText: { color: theme.colors.textPrimary, fontSize: 10.5, fontWeight: '700' },
  fab: {
    position: 'absolute',
    right: 8,
    width: FAB,
    height: FAB,
    borderRadius: FAB / 2,
    alignItems: 'center',
    justifyContent: 'center',
    // The white Play (`S2`), shown on one tile at a time as the pointer finds it.
    backgroundColor: theme.colors.textPrimary,
    ...floating(theme.colors),
  },
  fabPressed: { transform: [{ scale: 0.95 }] },
  spinner: { marginTop: space.xl },
}))
