import type { ReactNode } from 'react'
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import type { ListRenderItem } from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { formatLongDuration, type Playlist } from '@selfmp3/shared'
import { useLibrary } from '../src/api/queries'
import { useAccent } from '../src/ui/accent'
import { ChevronRight, ListMusic, Sparkles } from '../src/ui/components/Icons'
import { colors, radius, space, type } from '@selfmp3/client'

/**
 * Playlists: the web's cards, stacked one to a row because a phone is one
 * column wide. Pinned first, as in the web app's sidebar; a smart list wears
 * the sparkle and says it updates itself, as its card does there.
 *
 * Making one still wants the Mac's editor — a smart list is its rules — so
 * there is no "new playlist" here.
 */
export default function PlaylistsScreen(): ReactNode {
  const accent = useAccent()
  const library = useLibrary()
  const router = useRouter()

  const playlists = [...(library.data?.playlists ?? [])].sort(
    (a, b) => (a.pinned === b.pinned ? 0 : a.pinned ? -1 : 1) || a.name.localeCompare(b.name),
  )

  const renderPlaylist: ListRenderItem<Playlist> = ({ item }) => (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={() => router.push(`/playlist/${item.id}`)}
      accessibilityRole="button"
      accessibilityLabel={item.name}
    >
      <View style={styles.icon}>
        {item.kind === 'smart' ? (
          <Sparkles size={22} color={accent.accent} />
        ) : (
          <ListMusic size={22} color={accent.accent} />
        )}
      </View>
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {item.songCount} {item.songCount === 1 ? 'song' : 'songs'} ·{' '}
          {formatLongDuration(item.totalDuration)}
          {item.kind === 'smart' ? ' · updates itself' : ''}
        </Text>
        {item.description ? (
          <Text style={styles.description} numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}
      </View>
      {item.pinned ? (
        <Text style={[styles.pin, { color: accent.accent }]} accessibilityLabel="Pinned">
          ★
        </Text>
      ) : null}
      <ChevronRight size={18} color={colors.textMuted} />
    </Pressable>
  )

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.head}>
        <Text style={styles.heading}>Playlists</Text>
        <Text style={styles.sub}>
          {library.isPending
            ? 'Loading…'
            : playlists.length === 0
              ? 'None of your own yet'
              : `${playlists.length} ${playlists.length === 1 ? 'playlist' : 'playlists'}`}
        </Text>
      </View>

      {library.isPending ? (
        <ActivityIndicator style={styles.spinner} color={accent.accent} />
      ) : (
        <FlatList
          data={playlists}
          keyExtractor={playlist => String(playlist.id)}
          renderItem={renderPlaylist}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>Nothing of your own yet</Text>
              <Text style={styles.emptyHint}>
                Make one on the Mac — a smart playlist is worth trying first. It keeps itself up to
                date, and it turns up here.
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface0,
  },
  head: {
    paddingHorizontal: space.lg,
    paddingTop: 18,
    paddingBottom: space.lg,
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
  list: {
    paddingHorizontal: space.lg,
    paddingBottom: space.lg,
    gap: 10,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  cardPressed: {
    backgroundColor: colors.surface2,
    borderColor: colors.borderStrong,
  },
  icon: {
    width: 26,
    alignItems: 'center',
  },
  text: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  name: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  meta: {
    color: colors.textMuted,
    fontSize: type.small,
  },
  description: {
    color: colors.textMuted,
    fontSize: type.small,
    lineHeight: 17,
    marginTop: 1,
  },
  pin: {
    fontSize: 15,
  },
  spinner: {
    marginTop: space.xl,
  },
  emptyCard: {
    padding: space.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    borderRadius: radius.md,
    gap: space.sm,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: type.body,
    fontWeight: '600',
  },
  emptyHint: {
    color: colors.textMuted,
    fontSize: type.small,
    lineHeight: 18,
  },
})
