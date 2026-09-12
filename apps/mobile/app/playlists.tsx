import type { ReactNode } from 'react'
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import type { ListRenderItem } from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { formatLongDuration, type Playlist } from '@selfmp3/shared'
import { useLibrary } from '../src/api/queries'
import { useAccent } from '../src/ui/accent'
import { colors, space, type } from '../src/ui/theme'

/** Playlists, pinned first — the same order as the web app's sidebar. */
export default function PlaylistsScreen(): ReactNode {
  const accent = useAccent()
  const library = useLibrary()
  const router = useRouter()

  const playlists = [...(library.data?.playlists ?? [])].sort(
    (a, b) => (a.pinned === b.pinned ? 0 : a.pinned ? -1 : 1) || a.name.localeCompare(b.name),
  )

  const renderPlaylist: ListRenderItem<Playlist> = ({ item }) => (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      onPress={() => router.push(`/playlist/${item.id}`)}
    >
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={1}>
          {item.pinned ? '★ ' : ''}
          {item.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {item.kind === 'smart' ? 'Smart · ' : ''}
          {item.songCount} song{item.songCount === 1 ? '' : 's'} ·{' '}
          {formatLongDuration(item.totalDuration)}
        </Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  )

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.heading}>Playlists</Text>
      </View>

      {library.isPending ? (
        <ActivityIndicator style={styles.spinner} color={accent.accent} />
      ) : (
        <FlatList
          data={playlists}
          keyExtractor={playlist => String(playlist.id)}
          renderItem={renderPlaylist}
          ListEmptyComponent={
            <Text style={styles.empty}>No playlists yet. Make one on the Mac.</Text>
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
  header: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.sm,
  },
  heading: {
    color: colors.textPrimary,
    fontSize: type.large,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pressed: {
    backgroundColor: colors.surface2,
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    color: colors.textPrimary,
    fontSize: type.body,
    fontWeight: '500',
  },
  meta: {
    color: colors.textMuted,
    fontSize: type.small,
    marginTop: 1,
  },
  chevron: {
    color: colors.textMuted,
    fontSize: type.title,
  },
  spinner: {
    marginTop: space.xl,
  },
  empty: {
    color: colors.textMuted,
    fontSize: type.body,
    textAlign: 'center',
    marginTop: space.xl,
  },
})
