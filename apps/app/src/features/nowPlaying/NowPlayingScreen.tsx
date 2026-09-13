import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Animated,
  Easing,
  FlatList,
  Image,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import type { ListRenderItem } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { formatDuration, formatLongDuration, type Song } from '@selfmp3/shared'
import { useSimilar, useToggleLoved } from '../../api/queries'
import {
  HIT_TARGET,
  isDownloaded,
  loopRegionPercent,
  motion,
  radius,
  space,
  type,
  withAlpha,
} from '@selfmp3/client'
import { useDownloads } from '../../offline/DownloadsProvider'
import { usePlayer } from '../../player/PlayerProvider'
import { useSongColor } from '../../ui/useSongColor'
import { Cover } from '../../ui/components/Cover'
import { Equalizer } from '../../ui/components/Equalizer'
import { IconButton } from '../../ui/components/IconButton'
import { SimilarShelf } from './SimilarShelf'
import { Toggle } from '../../ui/components/Toggle'
import {
  ChevronDown,
  CloudDownload,
  Devices,
  Downloaded,
  Heart,
  Metronome,
  Mic,
  Moon,
  Next,
  Pause,
  Play,
  Prev,
  Queue,
  Repeat,
  RepeatOne,
  Romanize,
  Shuffle,
  X,
} from '../../ui/components/Icons'
import { Sheet } from '../../ui/components/Sheet'
import { SleepMenu } from '../../ui/components/SleepMenu'
import { DevicesSheet } from '../devices/DevicesSheet'
import { PracticePanel } from '../practice/PracticePanel'
import { SeekBar } from '../../ui/components/SeekBar'
import { useArt } from '../../offline/useArt'
import { OverlayProvider } from '../../shell/Overlay'
import { useLayout } from '../../shell/useLayout'
import { NowPlayingStage } from './NowPlayingStage'
import { romanName, autoMixLine, similarShelfLayout } from './nowPlaying.model'
import { StageLyrics } from './StageLyrics'
import { useSongWords } from './useSongWords'

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
export function NowPlayingScreen(): ReactNode {
  const { wide } = useLayout()
  const player = usePlayer()
  const router = useRouter()
  const { song: songParam } = useLocalSearchParams<{ song?: string }>()
  const songId = player.current?.id
  // The address names the song, so a refresh or a copied link comes back to it
  // (usePlaybackMemory reads it when the app opens).
  useEffect(() => {
    if (songId === undefined || songParam === String(songId)) return
    router.setParams({ song: String(songId) })
  }, [songId, songParam, router])
  // A computer gets the web's page, with the lyrics beside the art; a phone
  // keeps its own screen.
  // A phone presents this page as a native modal, above the whole app, the
  // shell's overlay host included: a sheet drawn there sat under the page and
  // never showed (Sleep, Devices, Practice). So the phone's page has a host of
  // its own, inside the modal.
  return wide ? (
    <NowPlayingStage />
  ) : (
    <OverlayProvider>
      <PhoneNowPlaying />
    </OverlayProvider>
  )
}

function PhoneNowPlaying(): ReactNode {
  const { theme } = useUnistyles()
  const artFor = useArt()
  const player = usePlayer()
  const router = useRouter()
  const toggleLoved = useToggleLoved()
  const { state: downloads, queue: downloadQueue, installed } = useDownloads()
  const { width, height } = useWindowDimensions()
  const songColor = useSongColor(player.current, player.current ? artFor(player.current) : null)

  const [panel, setPanel] = useState<Panel>('none')
  const [showWords, setShowWords] = useState(false)
  const [sleepOpen, setSleepOpen] = useState(false)
  const [practiceOpen, setPracticeOpen] = useState(false)
  const [devicesOpen, setDevicesOpen] = useState(false)

  const song = player.current

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
  // Nearest neighbours of what is playing, for the shelf under the controls.
  const similar = useSimilar(song?.id ?? null, 10)
  const similarSongs = similar.data?.songs ?? []
  const { artSize, showShelf } = similarShelfLayout({
    width,
    height,
    sidePadding: space.lg,
    similar: similarSongs.length,
  })

  if (song === null) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.head}>
          <IconButton onPress={() => router.back()} label="Close now playing" round>
            <ChevronDown size={24} color={theme.colors.textSecondary} />
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
    <View style={[styles.shell, { backgroundColor: songColor.color }]}>
      {/*
        The cover itself, blurred across the whole page behind everything: the
        computer's stage glow, which a phone cannot draw with a CSS filter. A
        song with no cover is washed in its tile's colour instead.
      */}
      <View pointerEvents="none" style={styles.backdrop}>
        {artFor(song) ? (
          <Image
            source={{ uri: artFor(song) ?? undefined }}
            blurRadius={60}
            resizeMode="cover"
            style={styles.backdropImage}
          />
        ) : null}
        <View
          style={[styles.backdrop, { backgroundColor: withAlpha(theme.colors.surface0, 0.58) }]}
        />
      </View>
      <SafeAreaView style={[styles.screen, styles.screenOverBackdrop]}>
        <View style={styles.head}>
          <IconButton onPress={() => router.back()} label="Close now playing" round>
            <ChevronDown size={24} color={theme.colors.textSecondary} />
          </IconButton>
          <Text style={styles.context} numberOfLines={1}>
            {player.queue.shuffle ? 'Shuffling' : 'Playing'} · {player.queue.index + 1} of{' '}
            {player.queue.items.length}
          </Text>
          <IconButton
            onPress={() => toggleLoved.mutate({ id: song.id, loved: !song.loved })}
            label={song.loved ? 'Unlove' : 'Love'}
            active={song.loved}
            round
          >
            <Heart
              size={22}
              filled={song.loved}
              color={song.loved ? theme.colors.danger : theme.colors.textSecondary}
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
                  <PhoneWords
                    song={song}
                    artUri={artFor(song)}
                    width={width}
                    onShowArt={() => setShowWords(false)}
                  />
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
                  loop={loopRegionPercent(player.loopA, player.loopB, player.duration)}
                  color={songColor.color}
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
                    color={player.queue.shuffle ? songColor.color : theme.colors.textMuted}
                  />
                </IconButton>
                <IconButton onPress={player.previous} label="Previous" size={52}>
                  <Prev size={30} color={theme.colors.textPrimary} />
                </IconButton>
                <Pressable
                  style={({ pressed }) => [
                    styles.playButton,
                    { backgroundColor: pressed ? songColor.tint : songColor.color },
                    pressed && styles.playButtonPressed,
                  ]}
                  onPress={player.toggle}
                  accessibilityRole="button"
                  accessibilityLabel={player.isPlaying ? 'Pause' : 'Play'}
                >
                  {player.isPlaying ? (
                    <Pause size={30} color={theme.colors.onAccent} />
                  ) : (
                    <Play size={30} color={theme.colors.onAccent} />
                  )}
                </Pressable>
                <IconButton onPress={player.next} label="Next" size={52}>
                  <Next size={30} color={theme.colors.textPrimary} />
                </IconButton>
                <IconButton
                  onPress={player.cycleRepeatMode}
                  label={REPEAT_LABEL[player.queue.repeat]}
                  active={player.queue.repeat !== 'off'}
                >
                  {player.queue.repeat === 'one' ? (
                    <RepeatOne size={19} color={songColor.color} />
                  ) : (
                    <Repeat
                      size={19}
                      color={
                        player.queue.repeat === 'off' ? theme.colors.textMuted : songColor.color
                      }
                    />
                  )}
                </IconButton>
              </View>

              {/* Under the lyrics the words have the room; the shelf is for the art. */}
              {showShelf && !showWords ? <SimilarShelf songs={similarSongs} /> : null}
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
                color={showWords && panel === 'none' ? songColor.color : theme.colors.textMuted}
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
              <Metronome
                size={19}
                color={
                  practiceOpen || player.loopB !== null ? songColor.color : theme.colors.textMuted
                }
              />
            }
            label="Practice"
            active={practiceOpen}
            onPress={() => setPracticeOpen(true)}
          />
          {installed ? (
            <FootAction
              icon={
                held ? (
                  <Downloaded size={19} color={songColor.color} knockout={theme.colors.surface0} />
                ) : (
                  <CloudDownload size={19} color={theme.colors.textMuted} />
                )
              }
              label={held ? 'On this phone' : 'Keep'}
              active={held}
              onPress={() => {
                if (!held) downloadQueue.enqueue([song.id])
              }}
            />
          ) : null}
          <FootAction
            icon={
              <Moon
                size={19}
                color={player.sleepTimerEndsAt !== null ? songColor.color : theme.colors.textMuted}
              />
            }
            label="Sleep"
            active={player.sleepTimerEndsAt !== null}
            onPress={() => setSleepOpen(true)}
          />
          <FootAction
            icon={<Devices size={19} color={theme.colors.textMuted} />}
            label="Devices"
            active={false}
            onPress={() => setDevicesOpen(true)}
          />
          <FootAction
            icon={
              <Queue
                size={19}
                color={panel === 'queue' ? songColor.color : theme.colors.textMuted}
              />
            }
            label="Queue"
            active={panel === 'queue'}
            onPress={() => setPanel(current => (current === 'queue' ? 'none' : 'queue'))}
          />
        </View>
        <Sheet open={practiceOpen} onClose={() => setPracticeOpen(false)} testID="practice-sheet">
          <View style={styles.practiceSheet}>
            <PracticePanel onClose={() => setPracticeOpen(false)} />
          </View>
        </Sheet>
        <SleepMenu open={sleepOpen} onClose={() => setSleepOpen(false)} />
        <DevicesSheet open={devicesOpen} onClose={() => setDevicesOpen(false)} />
      </SafeAreaView>
    </View>
  )
}

/**
 * The lyrics face on a phone: the song on one line with romaji or pinyin
 * beside it when the words can have them, and the same lyric view the
 * computer's page uses, sized for arm's length.
 */
function PhoneWords({
  song,
  artUri,
  width,
  onShowArt,
}: {
  song: Song
  artUri: string | null
  width: number
  onShowArt: () => void
}): ReactNode {
  const { theme } = useUnistyles()
  const lyrics = useSongWords(song)
  const words = lyrics.words
  const on = lyrics.romanizationOn
  // The web's `clamp(22px, 6.4vw, 28px)`.
  const fontSize = Math.min(28, Math.max(22, width * 0.064))

  return (
    <>
      <View style={styles.wordsHeadRow}>
        <Pressable
          style={[styles.wordsHead, styles.wordsHeadGrow]}
          onPress={onShowArt}
          accessibilityRole="button"
          accessibilityLabel="Show the artwork"
        >
          <Cover uri={artUri} title={song.album || song.title} size={44} />
          <View style={styles.wordsTitles}>
            <Text style={styles.wordsTitle} numberOfLines={1}>
              {song.title}
            </Text>
            <Text style={styles.wordsArtist} numberOfLines={1}>
              {song.artist || 'Unknown artist'}
            </Text>
          </View>
        </Pressable>
        {words.status === 'lyrics' && lyrics.language !== 'none' ? (
          <Pressable
            role="button"
            aria-pressed={on}
            onPress={() => lyrics.setRomanization(!on)}
            style={[styles.tool, on && styles.toolOn]}
          >
            <Romanize size={15} color={on ? theme.colors.surface0 : theme.colors.textSecondary} />
            <Text style={[styles.toolText, on && styles.toolTextOn]}>
              {romanName(lyrics.language)}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <View style={[styles.words, styles.wordsPadded]}>
        {words.status === 'lyrics' ? (
          <StageLyrics
            parsed={words.parsed}
            roman={words.roman}
            focus={false}
            fontSize={fontSize}
          />
        ) : (
          <Text style={styles.wordsStatus}>
            {words.status === 'loading'
              ? 'Looking for lyrics…'
              : words.status === 'instrumental'
                ? 'Instrumental'
                : 'No lyrics for this one.'}
          </Text>
        )}
      </View>
    </>
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
  // Lit in the playing song's colour, as the rest of the page is.
  const player = usePlayer()
  const artFor = useArt()
  const songColor = useSongColor(player.current, player.current ? artFor(player.current) : null)
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
    >
      {icon}
      <Text style={[styles.actionLabel, active && { color: songColor.color }]} numberOfLines={1}>
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
  const { theme } = useUnistyles()
  const player = usePlayer()
  const songColor = useSongColor(player.current, player.current ? artFor(player.current) : null)
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
          isCurrent && { backgroundColor: theme.colors.surface2, borderLeftColor: songColor.color },
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
              <Equalizer paused={!player.isPlaying} size={14} color={songColor.tint} />
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
          <X size={15} color={theme.colors.textMuted} />
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
          <X size={17} color={theme.colors.textSecondary} />
        </IconButton>
      </View>
      <View style={styles.queueToolbar}>
        <Toggle
          value={player.autoMix}
          onChange={player.setAutoMix}
          label="Auto-mix"
          testID="auto-mix"
        />
        <Text style={styles.queueToolbarLabel}>Auto-mix</Text>
        <Text style={styles.queueToolbarHint} numberOfLines={1}>
          {autoMixLine({
            autoMix: player.autoMix,
            canCrossfade: player.canCrossfade,
            upcoming: upcoming.length,
            nextCrossfadeSeconds: player.nextCrossfadeSeconds,
          })}
        </Text>
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

const styles = StyleSheet.create(theme => ({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
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
  shell: {
    flex: 1,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  backdropImage: {
    width: '100%',
    height: '100%',
    transform: [{ scale: 1.25 }],
  },
  screenOverBackdrop: {
    backgroundColor: 'transparent',
  },
  context: {
    flex: 1,
    color: theme.colors.textMuted,
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
    color: theme.colors.textPrimary,
    fontSize: 21,
    lineHeight: 26,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  artist: {
    color: theme.colors.textSecondary,
    fontSize: 15,
    textAlign: 'center',
  },
  album: {
    color: theme.colors.textMuted,
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
  wordsHeadRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  wordsHeadGrow: { flex: 1, minWidth: 0 },
  wordsPadded: { paddingHorizontal: space.lg - 6 },
  wordsStatus: { color: theme.colors.textMuted, fontSize: 13, textAlign: 'center', marginTop: 40 },
  tool: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 11,
    borderRadius: 999,
    backgroundColor: theme.colors.surface2,
  },
  toolOn: { backgroundColor: theme.colors.textPrimary },
  toolText: { color: theme.colors.textSecondary, fontSize: 12, fontWeight: '600' },
  toolTextOn: { color: theme.colors.surface0 },
  wordsTitles: {
    flex: 1,
    minWidth: 0,
  },
  wordsTitle: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  wordsArtist: {
    color: theme.colors.textSecondary,
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
  practiceSheet: { height: 560 },
  foot: {
    flexDirection: 'row',
    gap: 2,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
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
    backgroundColor: theme.colors.surface2,
  },
  actionLabel: {
    color: theme.colors.textMuted,
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
    borderBottomColor: theme.colors.border,
  },
  queueTitles: {
    flex: 1,
    minWidth: 0,
  },
  queueHeading: {
    color: theme.colors.textPrimary,
    fontSize: type.body,
    fontWeight: '600',
  },
  queueSub: {
    color: theme.colors.textMuted,
    fontSize: type.small,
  },
  queueToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  queueToolbarLabel: { color: theme.colors.textSecondary, fontSize: type.small, fontWeight: '500' },
  queueToolbarHint: {
    flex: 1,
    minWidth: 0,
    textAlign: 'right',
    color: theme.colors.textMuted,
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
    color: theme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  queuePastTitle: {
    color: theme.colors.textMuted,
    fontWeight: '500',
  },
  queueArtist: {
    color: theme.colors.textMuted,
    fontSize: 11,
  },
  queueDuration: {
    color: theme.colors.textMuted,
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
    color: theme.colors.textSecondary,
    fontSize: type.body,
    fontWeight: '600',
  },
  emptyText: {
    color: theme.colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
  },
}))
