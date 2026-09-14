import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import type { LayoutChangeEvent } from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { formatLongDuration, type Playlist, type Song } from '@selfmp3/shared'
import {
  clientApi,
  HIT_TARGET,
  radius,
  space,
  type,
  useGems,
  useLibrary,
  usePlaylistSongIds,
} from '@selfmp3/client'
import { useCreatePlaylist, useUpdatePlaylist } from '../../api/queries'
import { useArt } from '../../offline/useArt'
import { usePlayer } from '../../player/PlayerProvider'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../../ui/accent'
import { tip } from '../../ui/tip'
import { Button } from '../../ui/components/Button'
import { Cover } from '../../ui/components/Cover'
import { IconButton } from '../../ui/components/IconButton'
import { ListMusic, Play, Plus, Queue, Sparkles } from '../../ui/components/Icons'
import { newPlaylist, usePlaylistsModel } from './playlists.model'

/** Tiles at least this wide at desktop width, as many as fit; two across on a phone. */
const TILE_MIN_WIDTH = 176
const PHONE_COLUMNS = 2
const GAP = 14
/** The round play button over a tile's covers. */
const FAB = 38

/**
 * The playlist index: tiles, each wearing the covers of its first songs.
 *
 * Music is found by its artwork everywhere else in the app, so a playlist is
 * too — four covers in a square when four songs have art, one when fewer do.
 * Manual and smart lists sit side by side; a smart one says so on its tile.
 * A grid that fills the width at desktop size, two across on a phone.
 *
 * Making one is the web's inline form: a name, then straight into the new
 * playlist, where a smart one's rules are written.
 */
export function PlaylistsScreen(): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const router = useRouter()
  const { wide } = useLayout()
  const model = usePlaylistsModel()
  const library = useLibrary()
  const createPlaylist = useCreatePlaylist()
  const [creating, setCreating] = useState<Playlist['kind'] | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [gridWidth, setGridWidth] = useState(0)

  const { playlists } = model
  const songsById = useMemo(
    () => new Map((library.data?.songs ?? []).map(song => [song.id, song])),
    [library.data?.songs],
  )
  // A phone's grid is the window less the padding, known before anything is
  // measured, so the tiles never show at a guessed size first. A computer's page
  // column depends on the sidebar and the practice panel, so it is measured.
  const window = useWindowDimensions()
  const measured = wide ? gridWidth : window.width - space.lg * 2
  const columns = wide
    ? Math.max(PHONE_COLUMNS, Math.floor((measured + GAP) / (TILE_MIN_WIDTH + GAP)))
    : PHONE_COLUMNS
  // Floored, so rounding never pushes the last tile of a row onto the next.
  const tileWidth =
    measured > 0 ? Math.floor((measured - GAP * (columns - 1)) / columns) : undefined

  const toggleCreating = (kind: Playlist['kind']): void => {
    setError(null)
    setCreating(current => (current === kind ? null : kind))
  }

  const create = async (): Promise<void> => {
    const input = creating ? newPlaylist(creating, name) : null
    // Submitting twice before the first answer would make two of the same name.
    if (!input || createPlaylist.isPending) return
    try {
      const created = await createPlaylist.mutateAsync(input)
      setName('')
      setCreating(null)
      router.push(`/playlists/${created.id}`)
    } catch (caught) {
      // The name stays in the box, so trying again is one tap.
      setError(`Couldn’t create “${input.name}”: ${(caught as Error).message}`)
    }
  }

  const totalDuration = playlists.reduce((sum, playlist) => sum + playlist.totalDuration, 0)

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={[styles.head, wide && styles.headWide]}>
          <View>
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
          <View style={[styles.actions, !wide && styles.actionsCompact]}>
            <Button
              label="New playlist"
              icon={<Plus size={15} color={theme.colors.textPrimary} />}
              active={creating === 'manual'}
              onPress={() => toggleCreating('manual')}
            />
            <Button
              label="New smart playlist"
              icon={<Sparkles size={15} color={accent.onAccent} />}
              variant="primary"
              onPress={() => toggleCreating('smart')}
            />
          </View>
        </View>

        {creating ? (
          <View style={styles.form}>
            <View style={styles.formRow}>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                onSubmitEditing={() => void create()}
                placeholder={creating === 'smart' ? 'e.g. Chill, most played' : 'Playlist name'}
                placeholderTextColor={theme.colors.textMuted}
                accessibilityLabel={creating === 'smart' ? 'Smart playlist name' : 'Playlist name'}
                autoFocus
                autoCorrect={false}
              />
              <Button
                label="Create"
                variant="primary"
                disabled={!name.trim() || createPlaylist.isPending}
                onPress={() => void create()}
              />
              <Button
                label="Cancel"
                onPress={() => {
                  setCreating(null)
                  setName('')
                  setError(null)
                }}
              />
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>
        ) : null}

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
                songsById={songsById}
                onOpen={() => router.push(`/playlists/${playlist.id}`)}
              />
            ))}
            {/* The empty state takes the whole row: a tile's width is too narrow for a sentence. */}
            {playlists.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>Nothing of your own yet</Text>
                <Text style={styles.emptyHint}>
                  A <Text style={styles.emptyStrong}>smart playlist</Text> is worth trying first —
                  set a rule like “tagged chill and played more than 5 times” and it keeps itself up
                  to date forever.
                </Text>
                <View style={styles.emptyAction}>
                  <Button
                    label="New smart playlist"
                    icon={<Sparkles size={15} color={accent.onAccent} />}
                    variant="primary"
                    onPress={() => setCreating('smart')}
                  />
                </View>
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

/**
 * Forgotten gems, as a built-in tile among the playlists: the web's
 * `GemsPlaylistCard`.
 *
 * It is not a row in the database, so there is nothing to rename or delete.
 * Pressing it starts the list rather than opening a page, because the list is
 * different every time it is asked for, and a page showing "the" forgotten
 * gems would be lying about being stable. Hidden when there are none.
 */
function GemsTile({ width }: { width: number | undefined }): ReactNode {
  const { theme } = useUnistyles()
  const gems = useGems(30)
  const player = usePlayer()

  const data = gems.data
  if (gems.isError || !data || data.songs.length === 0) return null
  const ids = data.songs.map(song => song.id)
  const duration = data.songs.reduce((sum, song) => sum + song.duration, 0)

  return (
    <Tile
      songs={data.songs}
      width={width}
      name="Forgotten gems"
      detail={`${data.songs.length} songs · ${formatLongDuration(duration)}`}
      badge="Built in"
      openLabel="Play forgotten gems"
      onOpen={() => player.playFrom(ids, 0)}
      onPlay={() => player.playFrom(ids, 0)}
      playLabel="Play forgotten gems"
      trailing={revealed => (
        <View style={{ opacity: revealed ? 1 : 0 }}>
          <IconButton onPress={() => player.addToQueue(ids)} label="Add forgotten gems to the queue">
            <Queue size={15} color={theme.colors.textMuted} />
          </IconButton>
        </View>
      )}
    />
  )
}

function PlaylistTile({
  playlist,
  index,
  width,
  songsById,
  onOpen,
}: {
  playlist: Playlist
  index: number
  width: number | undefined
  songsById: ReadonlyMap<number, Song>
  onOpen: () => void
}): ReactNode {
  const accent = useAccent()
  const { theme } = useUnistyles()
  const player = usePlayer()
  const updatePlaylist = useUpdatePlaylist()
  // The same query the playlist's page reads, so opening it afterwards is instant.
  const { data } = usePlaylistSongIds(playlist.songCount > 0 ? playlist.id : null)
  const songs = useMemo(
    () =>
      // Twelve is plenty to find four with art, without walking a long list.
      (data?.songIds ?? []).slice(0, 12).flatMap(id => {
        const song = songsById.get(id)
        return song ? [song] : []
      }),
    [data?.songIds, songsById],
  )

  const playNow = (): void => {
    if (data && data.songIds.length > 0) {
      player.playFrom(data.songIds, 0)
      return
    }
    void clientApi()
      .playlistSongs(playlist.id)
      .then(({ songIds }) => {
        if (songIds.length > 0) player.playFrom(songIds, 0)
      })
      .catch(() => undefined)
  }

  return (
    <Tile
      testID={`playlist-row-${index}`}
      songs={songs}
      width={width}
      name={playlist.name}
      detail={`${playlist.songCount} ${playlist.songCount === 1 ? 'song' : 'songs'} · ${formatLongDuration(playlist.totalDuration)}`}
      badge={playlist.kind === 'smart' ? 'Smart' : undefined}
      // The library says it has songs; only the list of which is missing (the
      // server is not answering). A plain cover then, not "No songs yet".
      unknown={playlist.songCount > 0 && songs.length === 0}
      emptyIcon={playlist.kind === 'smart' ? Sparkles : ListMusic}
      emptyText={playlist.kind === 'smart' ? 'Nothing matches yet' : 'No songs yet'}
      openLabel={playlist.name}
      onOpen={onOpen}
      onPlay={playlist.songCount > 0 ? playNow : undefined}
      playLabel={`Play ${playlist.name}`}
      trailing={revealed => (
        <View style={{ opacity: revealed || playlist.pinned ? 1 : 0 }}>
          <IconButton
            onPress={() =>
              updatePlaylist.mutate({ id: playlist.id, patch: { pinned: !playlist.pinned } })
            }
            label={`Pin ${playlist.name} to the sidebar`}
            active={playlist.pinned}
          >
            <Text
              style={[
                styles.pin,
                { color: playlist.pinned ? accent.accent : theme.colors.textMuted },
              ]}
            >
              ★
            </Text>
          </IconButton>
        </View>
      )}
    />
  )
}

/**
 * One tile: the covers, a name, a line of detail. The play button and the
 * corner action are siblings of the pressable, not inside it, because in a
 * browser a pressable is a real <button> and buttons do not nest.
 */
function Tile({
  songs,
  width,
  name,
  detail,
  badge,
  unknown = false,
  emptyIcon = ListMusic,
  emptyText = 'No songs yet',
  openLabel,
  onOpen,
  onPlay,
  playLabel,
  trailing,
  testID,
}: {
  songs: readonly Song[]
  width: number | undefined
  name: string
  detail: string
  badge?: string
  /** There are songs, but which ones is not known right now. */
  unknown?: boolean
  emptyIcon?: typeof ListMusic
  emptyText?: string
  openLabel: string
  onOpen: () => void
  onPlay?: () => void
  playLabel: string
  trailing: (revealed: boolean) => ReactNode
  testID?: string
}): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const { finePointer } = useLayout()
  const [hovered, setHovered] = useState(false)
  // With a mouse the play button waits for the pointer; a finger always sees it.
  const revealed = !finePointer || hovered
  const EmptyIcon = emptyIcon

  return (
    <View
      style={[styles.tile, width ? { width } : styles.tileUnmeasured]}
      onPointerEnter={finePointer ? () => setHovered(true) : undefined}
      onPointerLeave={finePointer ? () => setHovered(false) : undefined}
    >
      <Pressable
        testID={testID}
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={openLabel}
        style={({ pressed }) => [styles.tileMain, pressed && styles.tilePressed]}
      >
        {width ? (
          songs.length > 0 ? (
            <Mosaic songs={songs} size={width} />
          ) : unknown ? (
            <View style={styles.art}>
              <Cover uri={null} title={name} size={width} radius={radius.md} />
            </View>
          ) : (
            <View style={[styles.art, styles.emptyArt, { width, height: width }]}>
              <EmptyIcon size={22} color={theme.colors.textMuted} />
              <Text style={styles.emptyArtText}>{emptyText}</Text>
            </View>
          )
        ) : (
          <View style={[styles.art, styles.artUnmeasured]} />
        )}
        {badge ? (
          <View style={styles.badge} pointerEvents="none">
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        ) : null}
        <Text style={styles.tileName} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.tileDetail} numberOfLines={1}>
          {detail}
        </Text>
      </Pressable>

      {width && onPlay ? (
        <Pressable
          onPress={onPlay}
          accessibilityRole="button"
          accessibilityLabel={playLabel}
          {...tip('Play')}
          style={({ pressed }) => [
            styles.fab,
            { top: width - FAB - space.sm, backgroundColor: accent.accent, opacity: revealed ? 1 : 0 },
            pressed && styles.fabPressed,
          ]}
        >
          <Play size={15} color={accent.onAccent} />
        </Pressable>
      ) : null}
      {width ? (
        <View style={[styles.trailing, { top: width + 2 }]}>{trailing(revealed)}</View>
      ) : null}
    </View>
  )
}

/**
 * Four covers in a square when four songs have art; the first cover when fewer
 * do. Each is a `Cover`, so one that fails to load (a Mac that is not running)
 * falls back to its letter tile rather than a grey hole.
 */
function Mosaic({ songs, size }: { songs: readonly Song[]; size: number }): ReactNode {
  const artFor = useArt()
  const withArt = songs.filter(song => artFor(song) !== null)
  const first = songs[0]

  if (withArt.length >= 4) {
    const half = size / 2
    return (
      <View style={[styles.art, styles.mosaic, { width: size, height: size }]}>
        {withArt.slice(0, 4).map(song => (
          <Cover
            key={song.id}
            uri={artFor(song)}
            title={song.album || song.title}
            size={half}
            radius={0}
          />
        ))}
      </View>
    )
  }
  const lead = withArt[0] ?? first
  return (
    <View style={styles.art}>
      <Cover
        uri={lead ? artFor(lead) : null}
        title={lead ? lead.album || lead.title : '?'}
        size={size}
        radius={radius.md}
      />
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  content: {
    paddingHorizontal: space.lg,
    paddingBottom: space.xl,
  },
  head: {
    paddingTop: 18,
    paddingBottom: space.lg,
    gap: space.md,
  },
  headWide: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  heading: {
    color: theme.colors.textPrimary,
    fontSize: type.large,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  sub: {
    color: theme.colors.textMuted,
    fontSize: 13,
    marginTop: 3,
  },
  actions: { flexDirection: 'row', gap: space.sm },
  actionsCompact: { justifyContent: 'space-between' },
  form: { paddingBottom: space.lg, gap: 6 },
  formRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 36,
    paddingHorizontal: 10,
    color: theme.colors.textPrimary,
    fontSize: 14,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: radius.sm,
  },
  error: { color: theme.colors.danger, fontSize: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: GAP, rowGap: space.lg + 4 },
  tile: { position: 'relative' },
  /* Before the grid is measured: a column's worth, so nothing jumps far. */
  tileUnmeasured: { width: TILE_MIN_WIDTH },
  tileMain: { gap: 2, borderRadius: radius.md },
  tilePressed: { opacity: 0.8 },
  art: {
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: theme.colors.surface2,
    marginBottom: space.sm,
  },
  artUnmeasured: { width: TILE_MIN_WIDTH, height: TILE_MIN_WIDTH },
  mosaic: { flexDirection: 'row', flexWrap: 'wrap' },
  emptyArt: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: theme.colors.borderStrong,
  },
  emptyArtText: { color: theme.colors.textMuted, fontSize: 12 },
  /* Over the covers, so it is dark in either theme. */
  badge: {
    position: 'absolute',
    top: space.sm,
    left: space.sm,
    paddingVertical: 2,
    paddingHorizontal: 7,
    borderRadius: 10,
    backgroundColor: 'rgba(11, 13, 19, 0.72)',
  },
  badgeText: { color: '#f4f5f9', fontSize: 10, fontWeight: '600', letterSpacing: 0.2 },
  /* Room on the right for the corner action beside the name. */
  tileName: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
    paddingRight: 30,
  },
  tileDetail: { color: theme.colors.textMuted, fontSize: 12, paddingRight: 30 },
  fab: {
    position: 'absolute',
    right: space.sm,
    width: FAB,
    height: FAB,
    borderRadius: FAB / 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 2,
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.45)',
  },
  fabPressed: { transform: [{ scale: 0.95 }] },
  trailing: { position: 'absolute', right: -8 },
  pin: { fontSize: 15, lineHeight: 18 },
  spinner: {
    marginTop: space.xl,
  },
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
  emptyHint: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 18 },
  emptyStrong: { color: theme.colors.textSecondary, fontWeight: '700' },
  emptyAction: { alignItems: 'flex-start', marginTop: 4, minHeight: HIT_TARGET - 8 },
}))
