import { useState } from 'react'
import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import type { LayoutChangeEvent } from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { formatLongDuration, type Playlist } from '@selfmp3/shared'
import { clientApi, HIT_TARGET, radius, space, type, useGems } from '@selfmp3/client'
import { useCreatePlaylist, useUpdatePlaylist } from '../../api/queries'
import { usePlayer } from '../../player/PlayerProvider'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../../ui/accent'
import { Button } from '../../ui/components/Button'
import { IconButton } from '../../ui/components/IconButton'
import { ListMusic, Play, Plus, Queue, Sparkles } from '../../ui/components/Icons'
import { newPlaylist, usePlaylistsModel } from './playlists.model'

/** The web's `.playlist-grid`: cards at least this wide, as many as fit. */
const CARD_MIN_WIDTH = 224
const GAP = 14

/**
 * The playlist index: the web's cards.
 *
 * Two kinds sit side by side — manual lists you curate, and smart lists that
 * build themselves from rules — told apart at a glance by their icon and by
 * "updates itself". A grid at desktop width, one card to a row on a phone.
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
  const createPlaylist = useCreatePlaylist()
  const [creating, setCreating] = useState<Playlist['kind'] | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [gridWidth, setGridWidth] = useState(0)

  const { playlists } = model
  const columns = wide ? Math.max(1, Math.floor((gridWidth + GAP) / (CARD_MIN_WIDTH + GAP))) : 1
  const cardWidth = gridWidth > 0 ? (gridWidth - GAP * (columns - 1)) / columns : undefined

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
                  : `${playlists.length} ${playlists.length === 1 ? 'playlist' : 'playlists'}`}
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
            <GemsPlaylistCard width={cardWidth} />
            {playlists.map((playlist, index) => (
              <PlaylistCard
                key={playlist.id}
                playlist={playlist}
                index={index}
                width={cardWidth}
                onOpen={() => router.push(`/playlists/${playlist.id}`)}
              />
            ))}
            {/* The empty state is a cell of the grid, so it lines up like one. */}
            {playlists.length === 0 ? (
              <View
                style={[styles.card, styles.emptyCard, cardWidth ? { width: cardWidth } : null]}
              >
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
 * Forgotten gems, as a built-in card among the playlists: the web's
 * `GemsPlaylistCard`.
 *
 * It is not a row in the database, so there is nothing to rename or delete.
 * Pressing it starts the list rather than opening a page, because the list is
 * different every time it is asked for, and a page showing "the" forgotten
 * gems would be lying about being stable. Hidden when there are none.
 */
function GemsPlaylistCard({ width }: { width: number | undefined }): ReactNode {
  const { theme } = useUnistyles()
  const gems = useGems(30)
  const player = usePlayer()
  const accent = useAccent()
  const { finePointer } = useLayout()
  const [hovered, setHovered] = useState(false)
  const revealed = !finePointer || hovered

  const data = gems.data
  if (gems.isError || !data || data.songs.length === 0) return null
  const ids = data.songs.map(song => song.id)
  const duration = data.songs.reduce((sum, song) => sum + song.duration, 0)

  return (
    <View
      style={[styles.card, hovered && styles.cardHovered, width ? { width } : null]}
      onPointerEnter={finePointer ? () => setHovered(true) : undefined}
      onPointerLeave={finePointer ? () => setHovered(false) : undefined}
    >
      <Pressable
        style={({ pressed }) => [styles.cardMain, pressed && styles.cardPressed]}
        onPress={() => player.playFrom(ids, 0)}
        accessibilityRole="button"
        accessibilityLabel="Play forgotten gems"
      >
        <View style={styles.cardIcon}>
          <Sparkles size={22} color={accent.accent} />
        </View>
        <Text style={styles.cardName}>Forgotten gems</Text>
        <Text style={styles.cardSub}>
          {data.songs.length} songs · {formatLongDuration(duration)}
        </Text>
        <Text style={styles.cardDescription} numberOfLines={2}>
          Built in · loved or well played, quiet for {data.minDays}+ days
        </Text>
      </Pressable>
      <View style={[styles.cardActions, { opacity: revealed ? 1 : 0 }]}>
        <IconButton onPress={() => player.playFrom(ids, 0)} label="Play forgotten gems">
          <Play size={16} color={theme.colors.textSecondary} />
        </IconButton>
        <IconButton onPress={() => player.addToQueue(ids)} label="Add forgotten gems to the queue">
          <Queue size={16} color={theme.colors.textSecondary} />
        </IconButton>
      </View>
    </View>
  )
}

function PlaylistCard({
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
  const player = usePlayer()
  const { finePointer } = useLayout()
  const updatePlaylist = useUpdatePlaylist()
  const [hovered, setHovered] = useState(false)
  // With a mouse the actions wait for the pointer; a pinned list says so anyway.
  const revealed = !finePointer || hovered

  const playNow = (): void => {
    void clientApi()
      .playlistSongs(playlist.id)
      .then(({ songIds }) => {
        if (songIds.length > 0) player.playFrom(songIds, 0)
      })
      .catch(() => undefined)
  }

  return (
    <View
      style={[styles.card, hovered && styles.cardHovered, width ? { width } : null]}
      onPointerEnter={finePointer ? () => setHovered(true) : undefined}
      onPointerLeave={finePointer ? () => setHovered(false) : undefined}
    >
      <Pressable
        testID={`playlist-row-${index}`}
        style={({ pressed }) => [styles.cardMain, pressed && styles.cardPressed]}
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={playlist.name}
      >
        <View style={styles.cardIcon}>
          {playlist.kind === 'smart' ? (
            <Sparkles size={22} color={accent.accent} />
          ) : (
            <ListMusic size={22} color={accent.accent} />
          )}
        </View>
        <Text style={styles.cardName}>{playlist.name}</Text>
        <Text style={styles.cardSub}>
          {playlist.songCount} {playlist.songCount === 1 ? 'song' : 'songs'} ·{' '}
          {formatLongDuration(playlist.totalDuration)}
          {playlist.kind === 'smart' ? ' · updates itself' : ''}
        </Text>
        {playlist.description ? (
          <Text style={styles.cardDescription} numberOfLines={2}>
            {playlist.description}
          </Text>
        ) : null}
      </Pressable>

      <View style={styles.cardActions}>
        <View style={{ opacity: revealed ? 1 : 0 }}>
          <IconButton
            onPress={playNow}
            label={`Play ${playlist.name}`}
            disabled={playlist.songCount === 0}
          >
            <Play size={16} color={theme.colors.textSecondary} />
          </IconButton>
        </View>
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
      </View>
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  card: {
    alignSelf: 'stretch',
    width: '100%',
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: radius.md,
  },
  cardHovered: {
    backgroundColor: theme.colors.surface2,
    borderColor: theme.colors.borderStrong,
  },
  cardMain: {
    padding: 18,
    gap: 3,
    borderRadius: radius.md,
  },
  cardPressed: {
    backgroundColor: theme.colors.surface2,
  },
  /* The action buttons live in this corner; the icon keeps out of their way. */
  cardIcon: { height: 26, marginBottom: space.sm },
  cardName: { color: theme.colors.textPrimary, fontSize: 15, fontWeight: '600' },
  cardSub: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 17 },
  cardDescription: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 4 },
  cardActions: {
    position: 'absolute',
    top: 10,
    right: space.sm,
    flexDirection: 'row',
    gap: 2,
  },
  pin: { fontSize: 15, lineHeight: 18 },
  spinner: {
    marginTop: space.xl,
  },
  emptyCard: {
    padding: 18,
    gap: space.sm,
    backgroundColor: 'transparent',
    borderStyle: 'dashed',
  },
  emptyTitle: { color: theme.colors.textPrimary, fontSize: 15, fontWeight: '600' },
  emptyHint: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 18 },
  emptyStrong: { color: theme.colors.textSecondary, fontWeight: '700' },
  emptyAction: { alignItems: 'flex-start', marginTop: 4, minHeight: HIT_TARGET - 8 },
}))
