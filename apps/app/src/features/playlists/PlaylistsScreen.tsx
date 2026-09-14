import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import type { LayoutChangeEvent } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { formatLongDuration, type Playlist } from '@selfmp3/shared'
import { radius, space, type, useGems } from '@selfmp3/client'
import { prefs } from '../../ports/prefs'
import { usePlayer } from '../../player/PlayerProvider'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../../ui/accent'
import { tip } from '../../ui/tip'
import { Button } from '../../ui/components/Button'
import { IconButton } from '../../ui/components/IconButton'
import { Live, Pin, Play, Plus } from '../../ui/components/Icons'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { Select } from '../../ui/components/Select'
import { NewPlaylist } from './NewPlaylist'
import { PlaylistCover } from './PlaylistCover'
import {
  isLive,
  isPlaylistSort,
  LIVE_NAME,
  PLAYLIST_SORTS,
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
 * Every playlist, as tiles wearing their songs' covers.
 *
 * In the order you last played them, by default, so the ones in use are first
 * without pinning anything; A–Z and newest are one choice away, and the
 * choice is remembered. Pinned playlists stay in the grid (with a pin on the
 * tile) as well as having a place of their own — the sidebar at desktop
 * width, a row along the top on a phone — so pinning never makes a playlist
 * look like it has gone.
 *
 * New makes any of the three: a playlist, a smart playlist, a live one.
 */
export function PlaylistsScreen(): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const router = useRouter()
  const { wide } = useLayout()
  const window = useWindowDimensions()
  const [sort, setSortState] = useState<PlaylistSort>(() => {
    const stored = prefs.get(SORT_PREF)
    return isPlaylistSort(stored) ? stored : 'recent'
  })
  const model = usePlaylistsModel(sort)
  const [newOpen, setNewOpen] = useState(false)
  const newRef = useRef<View>(null)
  const [gridWidth, setGridWidth] = useState(0)

  const setSort = (next: PlaylistSort): void => {
    setSortState(next)
    prefs.set(SORT_PREF, next)
  }

  const { playlists, pinned } = model
  const measured = wide ? gridWidth : window.width - space.lg * 2
  const columns = wide
    ? Math.max(PHONE_COLUMNS, Math.floor((measured + GAP) / (TILE_MIN_WIDTH + GAP)))
    : PHONE_COLUMNS
  const tileWidth =
    measured > 0 ? Math.floor((measured - GAP * (columns - 1)) / columns) : undefined
  const totalDuration = playlists.reduce((sum, playlist) => sum + playlist.totalDuration, 0)
  const open = (playlist: Playlist): void =>
    router.push({ pathname: '/playlists/[id]', params: { id: String(playlist.id) } })

  const sortSelect = (
    <Select
      size="small"
      value={sort}
      options={PLAYLIST_SORTS}
      onChange={setSort}
      label="Sort by"
      testID="playlists-sort"
    />
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
                : playlists.length === 0
                  ? 'None of your own yet'
                  : `${playlists.length} ${playlists.length === 1 ? 'playlist' : 'playlists'} · ${formatLongDuration(totalDuration)}`}
            </Text>
          </View>
          <View style={styles.headActions}>
            {wide ? sortSelect : null}
            <View ref={newRef} collapsable={false}>
              {wide ? (
                <Button
                  label="New"
                  variant="primary"
                  icon={<Plus size={15} color={accent.onAccent} />}
                  active={newOpen}
                  onPress={() => setNewOpen(current => !current)}
                  testID="playlists-new"
                />
              ) : (
                <IconButton
                  onPress={() => setNewOpen(current => !current)}
                  label="New playlist"
                  round
                  active={newOpen}
                  testID="playlists-new"
                >
                  <Plus size={20} color={theme.colors.textPrimary} />
                </IconButton>
              )}
            </View>
          </View>
        </View>

        {/* The sidebar holds pinned playlists at desktop width; a phone has none. */}
        {!wide && pinned.length > 0 ? (
          <>
            <Text style={styles.section}>PINNED</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.shelves}
              style={styles.shelfRow}
            >
              {pinned.map(playlist => (
                <Pressable
                  key={playlist.id}
                  onPress={() => open(playlist)}
                  accessibilityRole="button"
                  accessibilityLabel={playlist.name}
                  style={({ pressed }) => [styles.shelf, pressed && styles.pressed]}
                >
                  <PlaylistCover playlist={playlist} size={40} />
                  <View style={styles.shelfText}>
                    <Text style={styles.shelfName} numberOfLines={1}>
                      {playlist.name}
                    </Text>
                    <Text style={styles.tileSub} numberOfLines={1}>
                      {isLive(playlist)
                        ? `${LIVE_NAME} · ${playlist.songCount}`
                        : `${playlist.songCount} ${playlist.songCount === 1 ? 'song' : 'songs'}`}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          </>
        ) : null}

        {wide ? null : (
          <View style={styles.sectionRow}>
            <Text style={styles.section}>ALL PLAYLISTS</Text>
            {sortSelect}
          </View>
        )}

        {model.loading ? (
          <ActivityIndicator style={styles.spinner} color={accent.accent} />
        ) : (
          <View
            style={styles.grid}
            onLayout={(event: LayoutChangeEvent) => setGridWidth(event.nativeEvent.layout.width)}
          >
            {/* Built in, and not a playlist: nothing to delete or rename. */}
            <GemsTile width={tileWidth} />
            {playlists.map((playlist, index) => (
              <PlaylistTile
                key={playlist.id}
                playlist={playlist}
                index={index}
                width={tileWidth}
                onOpen={() => open(playlist)}
              />
            ))}
            {playlists.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>Nothing of your own yet</Text>
                <Text style={styles.emptyHint}>
                  Make a <Text style={styles.emptyStrong}>playlist</Text> and pick the songs, let a{' '}
                  <Text style={styles.emptyStrong}>smart playlist</Text> pick them from a template like
                  Most played, or make a <Text style={styles.emptyStrong}>{LIVE_NAME.toLowerCase()} playlist</Text>{' '}
                  that follows rules and keeps itself up to date.
                </Text>
                <View style={styles.emptyAction}>
                  <Button
                    label="New playlist"
                    variant="primary"
                    icon={<Plus size={15} color={accent.onAccent} />}
                    onPress={() => setNewOpen(true)}
                  />
                </View>
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>

      <NewPlaylist open={newOpen} onClose={() => setNewOpen(false)} anchorRef={newRef} />
    </SafeAreaView>
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

function PlaylistTile({
  playlist,
  index,
  width,
  onOpen,
}: {
  playlist: Playlist
  index: number
  width: number | undefined
  onOpen: () => void
}): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const playback = usePlaylistPlayback()
  const { finePointer } = useLayout()
  const [hovered, setHovered] = useState(false)
  const live = isLive(playlist)
  const songs = `${playlist.songCount} ${playlist.songCount === 1 ? 'song' : 'songs'}`
  // With a mouse the play button waits for the pointer; a finger opens the page.
  const showPlay = finePointer && hovered && playlist.songCount > 0 && width !== undefined

  return (
    <View
      style={[styles.tile, width ? { width } : null]}
      onPointerEnter={finePointer ? () => setHovered(true) : undefined}
      onPointerLeave={finePointer ? () => setHovered(false) : undefined}
    >
      <Pressable
        testID={`playlist-row-${index}`}
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={playlist.name}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <View>
          <PlaylistCover playlist={playlist} />
          {live ? (
            <View style={[styles.badge, styles.badgeRow]}>
              <Live size={11} color={theme.colors.textPrimary} />
              <Text style={styles.badgeText}>{LIVE_NAME}</Text>
            </View>
          ) : null}
          {playlist.pinned ? (
            <View style={styles.pinMark} accessibilityLabel="Pinned">
              <Pin size={11} color={accent.accent} />
            </View>
          ) : null}
        </View>
        <Text style={styles.tileName} numberOfLines={1}>
          {playlist.name}
        </Text>
        <Text style={styles.tileSub} numberOfLines={1}>
          {live ? `${LIVE_NAME} · ${songs}` : `${songs} · ${formatLongDuration(playlist.totalDuration)}`}
        </Text>
      </Pressable>

      {showPlay ? (
        <Pressable
          onPress={() => playback.playById(playlist.id)}
          accessibilityRole="button"
          accessibilityLabel={`Play ${playlist.name}`}
          {...tip('Play')}
          style={({ pressed }) => [
            styles.fab,
            { top: width - FAB - 8, backgroundColor: accent.accent },
            pressed && styles.fabPressed,
          ]}
        >
          <Play size={15} color={accent.onAccent} />
        </Pressable>
      ) : null}
    </View>
  )
}

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
  heading: {
    color: theme.colors.textPrimary,
    fontSize: type.large,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  sub: { color: theme.colors.textMuted, fontSize: 13, marginTop: 3 },
  headActions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  section: {
    color: theme.colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    marginBottom: space.sm,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.xs,
  },
  shelfRow: { marginHorizontal: -space.lg, marginBottom: space.lg },
  shelves: { gap: space.sm, paddingHorizontal: space.lg },
  shelf: {
    width: 176,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  shelfText: { flex: 1, minWidth: 0 },
  shelfName: { color: theme.colors.textPrimary, fontSize: 13, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  tile: { width: '100%' },
  pressed: { opacity: 0.75 },
  tileName: {
    color: theme.colors.textPrimary,
    fontSize: 13.5,
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
    backgroundColor: 'rgba(12, 12, 20, 0.78)',
  },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  badgeText: { color: theme.colors.textPrimary, fontSize: 10.5, fontWeight: '700' },
  pinMark: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(12, 12, 20, 0.78)',
  },
  fab: {
    position: 'absolute',
    right: 8,
    width: FAB,
    height: FAB,
    borderRadius: FAB / 2,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 6px 16px rgba(0, 0, 0, 0.45)',
  },
  fabPressed: { transform: [{ scale: 0.95 }] },
  spinner: { marginTop: space.xl },
  emptyCard: {
    width: '100%',
    padding: 18,
    gap: space.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.colors.border,
    borderRadius: radius.md,
  },
  emptyTitle: { color: theme.colors.textPrimary, fontSize: 15, fontWeight: '600' },
  emptyHint: { color: theme.colors.textMuted, fontSize: 13, lineHeight: 19, maxWidth: 520 },
  emptyStrong: { color: theme.colors.textSecondary, fontWeight: '700' },
  emptyAction: { alignItems: 'flex-start', marginTop: 4 },
}))
