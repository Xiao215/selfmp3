import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import type { LayoutChangeEvent } from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { formatLongDuration, type Playlist } from '@selfmp3/shared'
import { clientApi, colors, HIT_TARGET, radius, space, type } from '@selfmp3/client'
import { useCreatePlaylist, useUpdatePlaylist } from '../../api/queries'
import { usePlayer } from '../../player/PlayerProvider'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../../ui/accent'
import { Button } from '../../ui/components/Button'
import { IconButton } from '../../ui/components/IconButton'
import { ListMusic, Play, Plus, Sparkles } from '../../ui/components/Icons'
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
      router.push(`/playlist/${created.id}`)
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
              icon={<Plus size={15} color={colors.textPrimary} />}
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
                placeholderTextColor={colors.textMuted}
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
            {playlists.map((playlist, index) => (
              <PlaylistCard
                key={playlist.id}
                playlist={playlist}
                index={index}
                width={cardWidth}
                onOpen={() => router.push(`/playlist/${playlist.id}`)}
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
            <Play size={16} color={colors.textSecondary} />
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
              style={[styles.pin, { color: playlist.pinned ? accent.accent : colors.textMuted }]}
            >
              ★
            </Text>
          </IconButton>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface0,
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
    color: colors.textPrimary,
    fontSize: type.large,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  sub: {
    color: colors.textMuted,
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
    color: colors.textPrimary,
    fontSize: 14,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
  },
  error: { color: colors.danger, fontSize: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  card: {
    alignSelf: 'stretch',
    width: '100%',
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  cardHovered: {
    backgroundColor: colors.surface2,
    borderColor: colors.borderStrong,
  },
  cardMain: {
    padding: 18,
    gap: 3,
    borderRadius: radius.md,
  },
  cardPressed: {
    backgroundColor: colors.surface2,
  },
  /* The action buttons live in this corner; the icon keeps out of their way. */
  cardIcon: { height: 26, marginBottom: space.sm },
  cardName: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  cardSub: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  cardDescription: { color: colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 4 },
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
  emptyTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  emptyHint: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  emptyStrong: { color: colors.textSecondary, fontWeight: '700' },
  emptyAction: { alignItems: 'flex-start', marginTop: 4, minHeight: HIT_TARGET - 8 },
})
