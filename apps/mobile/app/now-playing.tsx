import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Animated,
  Easing,
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
import { formatDuration, formatLongDuration, type Song } from '@selfmp3/shared'
import { useLyrics, useToggleLoved } from '../src/api/queries'
import { isDownloaded } from '@selfmp3/client'
import { useDownloads } from '../src/offline/DownloadsProvider'
import { usePlayer } from '../src/player/PlayerProvider'
import { useAccent } from '../src/ui/accent'
import { Cover } from '../src/ui/components/Cover'
import { Equalizer } from '../src/ui/components/Equalizer'
import { IconButton } from '../src/ui/components/IconButton'
import {
  ChevronDown,
  CloudDownload,
  Downloaded,
  Heart,
  Mic,
  Next,
  Pause,
  Play,
  Prev,
  Queue,
  Repeat,
  RepeatOne,
  Shuffle,
  X,
} from '../src/ui/components/Icons'
import { Lyrics } from '../src/ui/components/Lyrics'
import { SeekBar } from '../src/ui/components/SeekBar'
import { colors, HIT_TARGET, motion, radius, space, type } from '../src/ui/theme'
import { useArt } from '../src/offline/useArt'

/** What covers the stage. Lyrics are not one of these: they sit where the artwork was. */
type Panel = 'none' | 'queue'

/**
 * The full-screen phone player: the web's `NowPlaying`, on the phone.
 *
 * Large artwork, thumb-reachable controls, and a scrubber with a hit area
 * big enough to grab while walking. The lyrics are the other page of the
 * same screen — tap the artwork, or Lyrics below — and take everything above
 * the scrubber, with the song shrunk to one line over them; the scrubber and
 * buttons stay, so you can read along and still skip. The queue slides over
 * the stage, so getting back is always one tap.
 *
 * A fixed head and foot with one flexible stage between them: the artwork is
 * the part that gives way on a short phone, so nothing below it can ever be
 * pushed off the bottom.
 */
export default function NowPlayingScreen(): ReactNode {
  const artFor = useArt()
  const player = usePlayer()
  const router = useRouter()
  const accent = useAccent()
  const toggleLoved = useToggleLoved()
  const { state: downloads, queue: downloadQueue } = useDownloads()
  const { width, height } = useWindowDimensions()

  const [panel, setPanel] = useState<Panel>('none')
  const [showWords, setShowWords] = useState(false)

  const song = player.current
  const lyrics = useLyrics(song?.id ?? null)

  // The face that just came in slides into place from its own side.
  const [slide] = useState(() => new Animated.Value(0))
  const shownFace = useRef(showWords)
  useEffect(() => {
    if (shownFace.current === showWords) return
    shownFace.current = showWords
    slide.setValue(showWords ? 1 : -1)
    Animated.timing(slide, {
      toValue: 0,
      duration: 260,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: true,
    }).start()
  }, [showWords, slide])

  // The queue fades over the stage, and the stage fades back.
  const [veil] = useState(() => new Animated.Value(0))
  useEffect(() => {
    Animated.timing(veil, {
      toValue: panel === 'queue' ? 1 : 0,
      duration: motion.slow,
      useNativeDriver: true,
    }).start()
  }, [panel, veil])

  // Sized from the room that is left, not the width alone: on a short phone
  // the art shrinks rather than pushing the controls off the bottom.
  const artSize = Math.max(180, Math.min(width - space.lg * 2, 340, height - 500))

  if (song === null) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.head}>
          <IconButton onPress={() => router.back()} label="Close now playing">
            <ChevronDown size={24} color={colors.textSecondary} />
          </IconButton>
        </View>
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Nothing playing</Text>
          <Text style={styles.emptyText}>Start a song and it turns up here, with its lyrics.</Text>
        </View>
      </SafeAreaView>
    )
  }

  const held = isDownloaded(downloads.index, song.id)
  const faceStyle = {
    opacity: slide.interpolate({ inputRange: [-1, 0, 1], outputRange: [0, 1, 0] }),
    transform: [
      { translateX: slide.interpolate({ inputRange: [-1, 0, 1], outputRange: [-40, 0, 40] }) },
    ],
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.head}>
        <IconButton onPress={() => router.back()} label="Close now playing">
          <ChevronDown size={24} color={colors.textSecondary} />
        </IconButton>
        <Text style={styles.context} numberOfLines={1}>
          {player.queue.shuffle ? 'Shuffling' : 'Playing'} · {player.queue.index + 1} of{' '}
          {player.queue.items.length}
        </Text>
        <IconButton
          onPress={() => toggleLoved.mutate({ id: song.id, loved: !song.loved })}
          label={song.loved ? 'Unlove' : 'Love'}
          active={song.loved}
        >
          <Heart
            size={22}
            filled={song.loved}
            color={song.loved ? colors.danger : colors.textSecondary}
          />
        </IconButton>
      </View>

      <View style={styles.stage}>
        {panel === 'queue' ? (
          <Animated.View style={[styles.panel, { opacity: veil }]}>
            <QueuePanel onClose={() => setPanel('none')} artFor={artFor} />
          </Animated.View>
        ) : (
          <>
            {showWords ? (
              <Animated.View style={[styles.face, faceStyle]}>
                <Pressable
                  style={styles.wordsHead}
                  onPress={() => setShowWords(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Show the artwork"
                >
                  <Cover uri={artFor(song)} title={song.album || song.title} size={44} />
                  <View style={styles.wordsTitles}>
                    <Text style={styles.wordsTitle} numberOfLines={1}>
                      {song.title}
                    </Text>
                    <Text style={styles.wordsArtist} numberOfLines={1}>
                      {song.artist || 'Unknown artist'}
                    </Text>
                  </View>
                </Pressable>
                <View style={styles.words}>
                  <Lyrics
                    text={lyrics.data?.text ?? null}
                    position={player.position}
                    loading={lyrics.isPending}
                    error={lyrics.isError}
                  />
                </View>
              </Animated.View>
            ) : (
              <Animated.View style={[styles.face, faceStyle]}>
                <View style={styles.art}>
                  <Pressable
                    onPress={() => setShowWords(true)}
                    accessibilityRole="button"
                    accessibilityLabel="Show the lyrics"
                    style={styles.artShadow}
                  >
                    <Cover uri={artFor(song)} title={song.album || song.title} size={artSize} />
                  </Pressable>
                </View>

                <View style={styles.meta}>
                  <Text style={styles.title} numberOfLines={2}>
                    {song.title}
                  </Text>
                  <Text style={styles.artist} numberOfLines={1}>
                    {song.artist || 'Unknown artist'}
                  </Text>
                  {song.album ? (
                    <Text style={styles.album} numberOfLines={1}>
                      {song.album}
                      {song.year ? ` · ${song.year}` : ''}
                    </Text>
                  ) : null}
                </View>
              </Animated.View>
            )}

            <View style={styles.progress}>
              <SeekBar
                position={player.position}
                duration={player.duration}
                onSeek={player.seekTo}
              />
            </View>

            <View style={styles.controls}>
              <IconButton
                onPress={player.toggleShuffle}
                label={`Shuffle ${player.queue.shuffle ? 'on' : 'off'}`}
                active={player.queue.shuffle}
              >
                <Shuffle
                  size={19}
                  color={player.queue.shuffle ? accent.accent : colors.textMuted}
                />
              </IconButton>
              <IconButton onPress={player.previous} label="Previous" size={52}>
                <Prev size={30} color={colors.textPrimary} />
              </IconButton>
              <Pressable
                style={({ pressed }) => [
                  styles.playButton,
                  { backgroundColor: pressed ? accent.accentStrong : accent.accent },
                  pressed && styles.playButtonPressed,
                ]}
                onPress={player.toggle}
                accessibilityRole="button"
                accessibilityLabel={player.isPlaying ? 'Pause' : 'Play'}
              >
                {player.isPlaying ? (
                  <Pause size={30} color={colors.onAccent} />
                ) : (
                  <Play size={30} color={colors.onAccent} />
                )}
              </Pressable>
              <IconButton onPress={player.next} label="Next" size={52}>
                <Next size={30} color={colors.textPrimary} />
              </IconButton>
              <IconButton
                onPress={player.cycleRepeatMode}
                label={REPEAT_LABEL[player.queue.repeat]}
                active={player.queue.repeat !== 'off'}
              >
                {player.queue.repeat === 'one' ? (
                  <RepeatOne size={19} color={accent.accent} />
                ) : (
                  <Repeat
                    size={19}
                    color={player.queue.repeat === 'off' ? colors.textMuted : accent.accent}
                  />
                )}
              </IconButton>
            </View>
          </>
        )}
      </View>

      {/*
        Bare glyphs say nothing about what they open. Each is a labelled,
        finger-sized target — the same trade the tab bar makes.
      */}
      <View style={styles.foot}>
        <FootAction
          icon={
            <Mic
              size={19}
              color={showWords && panel === 'none' ? accent.accent : colors.textMuted}
            />
          }
          label="Lyrics"
          active={showWords && panel === 'none'}
          onPress={() => {
            setPanel('none')
            setShowWords(panel !== 'none' || !showWords)
          }}
        />
        <FootAction
          icon={
            held ? (
              <Downloaded size={19} color={accent.accent} knockout={colors.surface0} />
            ) : (
              <CloudDownload size={19} color={colors.textMuted} />
            )
          }
          label={held ? 'On this phone' : 'Keep'}
          active={held}
          onPress={() => {
            if (!held) downloadQueue.enqueue([song.id])
          }}
        />
        <FootAction
          icon={<Queue size={19} color={panel === 'queue' ? accent.accent : colors.textMuted} />}
          label="Queue"
          active={panel === 'queue'}
          onPress={() => setPanel(current => (current === 'queue' ? 'none' : 'queue'))}
        />
      </View>
    </SafeAreaView>
  )
}

/** Said as a sentence, because "Repeat: off" is not what a screen reader wants. */
const REPEAT_LABEL: Record<'off' | 'all' | 'one', string> = {
  off: 'Repeat off',
  all: 'Repeat all',
  one: 'Repeat this song',
}

function FootAction({
  icon,
  label,
  active,
  onPress,
}: {
  icon: ReactNode
  label: string
  active: boolean
  onPress: () => void
}): ReactNode {
  const accent = useAccent()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
    >
      {icon}
      <Text style={[styles.actionLabel, active && { color: accent.accent }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  )
}

/**
 * Up next: the web's `QueuePanel`, over the stage.
 *
 * A tap plays that entry; the X drops it. Dragging to reorder waits for a
 * gesture library — a thumb on a FlatList row is a scroll, and pretending
 * otherwise makes both worse.
 */
function QueuePanel({
  onClose,
  artFor,
}: {
  onClose: () => void
  artFor: (song: Song) => string | null
}): ReactNode {
  const player = usePlayer()
  const accent = useAccent()
  const listRef = useRef<FlatList<Song>>(null)

  const upcoming = player.songs.slice(player.queue.index + 1)
  const remaining = upcoming.reduce((sum, song) => sum + song.duration, 0)

  // Open on the song that is playing, not the top of a long list.
  useEffect(() => {
    if (player.songs.length === 0) return
    const timer = setTimeout(() => {
      listRef.current?.scrollToIndex({
        index: player.queue.index,
        viewPosition: 0.2,
        animated: false,
      })
    }, 50)
    return () => clearTimeout(timer)
    // Only on open: following the index afterwards would fight a scrolling thumb.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const renderItem: ListRenderItem<Song> = ({ item, index }) => {
    const isCurrent = index === player.queue.index
    const isPast = index < player.queue.index
    return (
      <View
        style={[
          styles.queueRow,
          isCurrent && { backgroundColor: colors.surface2, borderLeftColor: accent.accent },
        ]}
      >
        <Pressable
          style={styles.queueMain}
          onPress={() => player.jumpTo(index)}
          accessibilityRole="button"
          accessibilityLabel={`Play ${item.title}`}
        >
          {isCurrent ? (
            <View style={styles.queueMarker}>
              <Equalizer paused={!player.isPlaying} size={14} />
            </View>
          ) : (
            <View style={isPast && styles.queuePastArt}>
              <Cover uri={artFor(item)} title={item.album || item.title} size={34} />
            </View>
          )}
          <View style={styles.queueMeta}>
            <Text style={[styles.queueTitle, isPast && styles.queuePastTitle]} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.queueArtist} numberOfLines={1}>
              {item.artist || 'Unknown artist'}
            </Text>
          </View>
          <Text style={styles.queueDuration}>{formatDuration(item.duration)}</Text>
        </Pressable>
        <IconButton
          onPress={() => player.removeFromQueue(index)}
          label={`Remove ${item.title} from queue`}
          size={36}
        >
          <X size={15} color={colors.textMuted} />
        </IconButton>
      </View>
    )
  }

  return (
    <View style={styles.queue}>
      <View style={styles.queueHead}>
        <View style={styles.queueTitles}>
          <Text style={styles.queueHeading}>Up next</Text>
          <Text style={styles.queueSub} numberOfLines={1}>
            {player.songs.length === 0
              ? 'Nothing playing'
              : upcoming.length === 0
                ? 'Nothing after this one'
                : `${upcoming.length} ${upcoming.length === 1 ? 'song' : 'songs'} · ${formatLongDuration(remaining)} left`}
          </Text>
        </View>
        <IconButton onPress={onClose} label="Close queue" size={36}>
          <X size={17} color={colors.textSecondary} />
        </IconButton>
      </View>
      <FlatList
        ref={listRef}
        data={player.songs}
        keyExtractor={(item, index) => `${item.id}-${index}`}
        renderItem={renderItem}
        initialNumToRender={14}
        getItemLayout={(_data, index) => ({ length: QUEUE_ROW, offset: QUEUE_ROW * index, index })}
        contentContainerStyle={styles.queueList}
        onScrollToIndexFailed={() => undefined}
      />
    </View>
  )
}

const QUEUE_ROW = 52

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface0,
    paddingHorizontal: space.lg,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingTop: space.sm,
    marginHorizontal: -space.sm,
  },
  context: {
    flex: 1,
    color: colors.textMuted,
    fontSize: type.tiny,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  stage: {
    flex: 1,
    minHeight: 0,
  },
  face: {
    flex: 1,
    minHeight: 0,
  },
  art: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  artShadow: {
    borderRadius: radius.lg,
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  meta: {
    alignItems: 'center',
    paddingHorizontal: space.xs,
    paddingTop: space.xs,
    paddingBottom: 14,
    gap: 3,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 21,
    lineHeight: 26,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  artist: {
    color: colors.textSecondary,
    fontSize: 15,
    textAlign: 'center',
  },
  album: {
    color: colors.textMuted,
    fontSize: type.small,
    textAlign: 'center',
  },
  wordsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: HIT_TARGET,
    paddingVertical: 6,
  },
  wordsTitles: {
    flex: 1,
    minWidth: 0,
  },
  wordsTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  wordsArtist: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  words: {
    flex: 1,
    minHeight: 0,
    marginHorizontal: -space.lg,
  },
  progress: {
    marginBottom: 6,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xs,
    marginBottom: 14,
  },
  playButton: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButtonPressed: {
    transform: [{ scale: 0.96 }],
  },
  foot: {
    flexDirection: 'row',
    gap: 2,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 6,
    paddingBottom: 6,
  },
  action: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minHeight: HIT_TARGET,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  actionPressed: {
    backgroundColor: colors.surface2,
  },
  actionLabel: {
    color: colors.textMuted,
    fontSize: type.label,
    fontWeight: '600',
  },
  panel: {
    flex: 1,
    minHeight: 0,
  },
  queue: {
    flex: 1,
    minHeight: 0,
    marginHorizontal: -space.lg,
  },
  queueHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    minHeight: 58,
    paddingLeft: space.lg,
    paddingRight: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  queueTitles: {
    flex: 1,
    minWidth: 0,
  },
  queueHeading: {
    color: colors.textPrimary,
    fontSize: type.body,
    fontWeight: '600',
  },
  queueSub: {
    color: colors.textMuted,
    fontSize: type.small,
  },
  queueList: {
    padding: space.sm,
    gap: 1,
  },
  queueRow: {
    height: QUEUE_ROW,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.sm,
    borderLeftWidth: 2,
    borderLeftColor: 'transparent',
    paddingRight: 2,
  },
  queueMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  queueMarker: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  queuePastArt: {
    opacity: 0.55,
  },
  queueMeta: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  queueTitle: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  queuePastTitle: {
    color: colors.textMuted,
    fontWeight: '500',
  },
  queueArtist: {
    color: colors.textMuted,
    fontSize: 11,
  },
  queueDuration: {
    color: colors.textMuted,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: space.xl,
  },
  emptyTitle: {
    color: colors.textSecondary,
    fontSize: type.body,
    fontWeight: '600',
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
  },
})
