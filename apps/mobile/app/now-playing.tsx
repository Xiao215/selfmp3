import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import type { ListRenderItem } from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { Song } from '@selfmp3/shared'
import { mediaUrl } from '../src/api/client'
import { useLyrics } from '../src/api/queries'
import { usePlayer } from '../src/player/PlayerProvider'
import { useConnection } from '../src/server/ConnectionProvider'
import { Cover } from '../src/ui/components/Cover'
import { Glyph } from '../src/ui/components/Glyph'
import { Lyrics } from '../src/ui/components/Lyrics'
import { SeekBar } from '../src/ui/components/SeekBar'
import { colors, radius, space, type } from '../src/ui/theme'

/**
 * Now Playing: art, transport, and a panel that is either the synced lyrics or
 * the queue.
 *
 * One panel at a time rather than a scrolling stack — on a phone, lyrics that
 * scroll themselves and a queue that the user scrolls cannot share a screen
 * without one of them fighting the other.
 */
export default function NowPlayingScreen(): ReactNode {
  const player = usePlayer()
  const { connection } = useConnection()
  const router = useRouter()
  const { width } = useWindowDimensions()
  const [panel, setPanel] = useState<'lyrics' | 'queue'>('lyrics')

  const song = player.current
  const lyrics = useLyrics(song?.id ?? null)

  const artSize = Math.min(width - space.xl * 2, 320)

  const renderQueueItem: ListRenderItem<Song> = ({ item, index }) => (
    <Pressable
      style={({ pressed }) => [styles.queueRow, pressed && styles.queueRowPressed]}
      onPress={() => player.jumpTo(index)}
    >
      <Text
        style={[styles.queueTitle, index === player.queue.index && styles.queueActive]}
        numberOfLines={1}
      >
        {item.title}
      </Text>
      <Text style={styles.queueArtist} numberOfLines={1}>
        {item.artist}
      </Text>
    </Pressable>
  )

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Glyph name="down" size={22} color={colors.textSecondary} />
        </Pressable>
        <Text style={styles.topBarLabel}>Now playing</Text>
        <View style={styles.topBarSpacer} />
      </View>

      {song === null ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Nothing is playing.</Text>
        </View>
      ) : (
        <>
          <View style={styles.art}>
            <Cover
              uri={song.hasArt && connection ? mediaUrl.art(connection, song.id) : null}
              title={song.album || song.title}
              size={artSize}
            />
          </View>

          <View style={styles.info}>
            <Text style={styles.title} numberOfLines={2}>
              {song.title}
            </Text>
            <Text style={styles.artist} numberOfLines={1}>
              {song.artist || 'Unknown artist'}
              {song.album ? ` · ${song.album}` : ''}
            </Text>
          </View>

          <View style={styles.seek}>
            <SeekBar position={player.position} duration={player.duration} onSeek={player.seekTo} />
          </View>

          <View style={styles.transport}>
            <Pressable hitSlop={10} onPress={player.toggleShuffle}>
              <Glyph
                name="shuffle"
                size={20}
                color={player.queue.shuffle ? colors.accent : colors.textMuted}
              />
            </Pressable>

            <Pressable hitSlop={10} onPress={player.previous}>
              <Glyph name="previous" size={26} />
            </Pressable>

            <Pressable style={styles.playButton} onPress={player.toggle}>
              <Glyph
                name={player.isPlaying ? 'pause' : 'play'}
                size={24}
                color={colors.onAccent}
              />
            </Pressable>

            <Pressable hitSlop={10} onPress={player.next}>
              <Glyph name="next" size={26} />
            </Pressable>

            <Pressable hitSlop={10} onPress={player.cycleRepeatMode}>
              <Glyph
                name={player.queue.repeat === 'one' ? 'repeatOne' : 'repeat'}
                size={20}
                color={player.queue.repeat === 'off' ? colors.textMuted : colors.accent}
              />
            </Pressable>
          </View>

          <View style={styles.tabs}>
            <PanelTab
              label="Lyrics"
              active={panel === 'lyrics'}
              onPress={() => setPanel('lyrics')}
            />
            <PanelTab
              label={`Queue (${player.songs.length})`}
              active={panel === 'queue'}
              onPress={() => setPanel('queue')}
            />
          </View>

          <View style={styles.panel}>
            {panel === 'lyrics' ? (
              <Lyrics
                text={lyrics.data?.text ?? null}
                position={player.position}
                loading={lyrics.isPending}
                error={lyrics.isError}
              />
            ) : (
              <FlatList
                data={player.songs}
                keyExtractor={(item, index) => `${item.id}-${index}`}
                renderItem={renderQueueItem}
                initialNumToRender={12}
              />
            )}
          </View>
        </>
      )}
    </SafeAreaView>
  )
}

function PanelTab({
  label,
  active,
  onPress,
}: {
  label: string
  active: boolean
  onPress: () => void
}): ReactNode {
  return (
    <Pressable onPress={onPress} style={[styles.tab, active && styles.tabActive]}>
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface0,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  topBarLabel: {
    color: colors.textMuted,
    fontSize: type.tiny,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  topBarSpacer: {
    width: 22,
  },
  art: {
    alignItems: 'center',
    paddingTop: space.sm,
  },
  info: {
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
    alignItems: 'center',
    gap: 2,
  },
  title: {
    color: colors.textPrimary,
    fontSize: type.large,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  artist: {
    color: colors.textSecondary,
    fontSize: type.body,
    textAlign: 'center',
  },
  seek: {
    paddingHorizontal: space.xl,
    paddingTop: space.sm,
  },
  transport: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
  },
  playButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabs: {
    flexDirection: 'row',
    gap: space.xs,
    paddingHorizontal: space.lg,
  },
  tab: {
    paddingVertical: space.xs,
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
  },
  tabActive: {
    backgroundColor: colors.surface2,
  },
  tabLabel: {
    color: colors.textMuted,
    fontSize: type.small,
    fontWeight: '600',
  },
  tabLabelActive: {
    color: colors.textPrimary,
  },
  panel: {
    flex: 1,
    marginTop: space.sm,
  },
  queueRow: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  queueRowPressed: {
    backgroundColor: colors.surface2,
  },
  queueTitle: {
    color: colors.textPrimary,
    fontSize: type.body,
  },
  queueActive: {
    color: colors.accent,
    fontWeight: '600',
  },
  queueArtist: {
    color: colors.textMuted,
    fontSize: type.small,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: type.body,
  },
})
