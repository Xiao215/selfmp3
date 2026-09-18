import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Animated,
  Easing,
  FlatList,
  Image,
  PanResponder,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import type { ListRenderItem } from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { formatDuration, formatLongDuration, type Song } from '@selfmp3/shared'
import {
  fonts,
  HIT_TARGET,
  isDownloaded,
  loopRegionPercent,
  motion,
  radius,
  space,
  type,
  withAlpha,
  useSimilar,
  useToggleLoved,
} from '@selfmp3/client'
import { useDownloads } from '../../offline/DownloadsProvider'
import { usePlayer, usePlayerProgress } from '../../player/PlayerProvider'
import { useSongColor } from '../../ui/useSongColor'
import { Cover } from '../../ui/components/Cover'
import { Equalizer } from '../../ui/components/Equalizer'
import { PlayButton } from '../../ui/components/Button'
import { IconButton } from '../../ui/components/IconButton'
import { SimilarShelf } from './SimilarShelf'
import { Toggle } from '../../ui/components/Toggle'
import {
  ChevronDown,
  ChevronRight,
  CloudDownload,
  Devices,
  Downloaded,
  Heart,
  Metronome,
  Mic,
  Moon,
  Next,
  Prev,
  Queue,
  Repeat,
  RepeatOne,
  Romanize,
  Shuffle,
  Sparkles,
  X,
} from '../../ui/components/Icons'
import { Sheet } from '../../ui/components/Sheet'
import { SleepMenu, useSleepMinutesLeft } from '../../ui/components/SleepMenu'
import { DevicesSheet } from '../devices/DevicesSheet'
import { PracticePanel } from '../practice/PracticePanel'
import { SeekBar } from '../../ui/components/SeekBar'
import { useArt } from '../../offline/useArt'
import { OverlayProvider } from '../../shell/Overlay'
import { useLayout } from '../../shell/useLayout'
import { NowPlayingStage } from './NowPlayingStage'
import {
  autoMixLine,
  queueLines,
  romanName,
  similarShelfLayout,
  SIMILAR_SHELF_HEIGHT,
  upNextLine,
  type QueueLine,
} from './nowPlaying.model'
import { SongVisual } from './SongVisual'
import { StageLyrics } from './StageLyrics'
import { useMotionSampler } from './useMotionSampler'
import { useSongWords } from './useSongWords'
import { useSongVisual } from './visualChoice'
import { motionCaption, VISUAL_NAMES } from './visuals.model'
import { VisualStyleMenu } from './VisualStyleMenu'
import { label, sectionTitle } from '../../ui/surfaces'
import { PlayPauseIcon } from '../../ui/components/PlayPauseIcon'

/** What covers the stage. Lyrics are not one of these: they sit where the artwork was. */
type Panel = 'none' | 'queue'

/**
 * The full-screen phone player.
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
  // A computer gets `NowPlayingStage`, with the lyrics beside the art; a phone
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
  const { state: downloads, requestDownload, installed } = useDownloads()
  const { width, height } = useWindowDimensions()
  const songColor = useSongColor(player.current, player.current ? artFor(player.current) : null)

  const [panel, setPanel] = useState<Panel>('none')
  const [showWords, setShowWords] = useState(false)
  const [sleepOpen, setSleepOpen] = useState(false)
  // While the timer runs the Sleep button says how long is left, not just "Sleep".
  const sleepLeft = useSleepMinutesLeft(player.sleepTimerEndsAt)
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

  // The window's insets, from the provider at the root. A SafeAreaView measures
  // its own place on screen, and this page slides up from below: caught
  // mid-slide it measured no status bar at all, and the head sat under the clock.
  const insets = useSafeAreaInsets()
  const edges = {
    paddingTop: insets.top,
    paddingBottom: insets.bottom,
    paddingLeft: space.lg + insets.left,
    paddingRight: space.lg + insets.right,
  }

  // A long pull down puts the page away, as Apple Music's does. Asked only on a
  // move, so taps, the scrubber (which refuses to let go) and the scrolling
  // lyrics, queue and shelf keep their own touches. The page gives a little
  // under the finger rather than following it: the putting-away itself is the
  // modal's own slide, the same one the chevron plays, so the two feel alike
  // and there is never a torn edge between the page and the frame behind it.
  const [pull] = useState(() => new Animated.Value(0))
  const give = pull.interpolate({
    inputRange: [0, 600],
    outputRange: [0, 150],
    extrapolate: 'clamp',
  })
  const dismiss = useMemo(() => {
    const settle = (): void => {
      Animated.spring(pull, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start()
    }
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) =>
        gesture.dy > 12 && gesture.dy > Math.abs(gesture.dx) * 2,
      onPanResponderMove: (_event, gesture) => pull.setValue(Math.max(0, gesture.dy)),
      onPanResponderRelease: (_event, gesture) => {
        if (gesture.dy > DISMISS_DISTANCE || (gesture.dy > 48 && gesture.vy > DISMISS_VELOCITY)) {
          router.back()
        } else {
          settle()
        }
      },
      onPanResponderTerminate: settle,
    })
  }, [pull, router])

  /*
   * Nearest neighbours of what is playing, for the shelf under the controls —
   * and with them the cover's size, which is what is left of the room once the
   * shelf has had its share (on a short phone the cover shrinks rather than
   * pushing the controls off the bottom).
   *
   * Changing songs asks a new question, and until it is answered this page
   * knows nothing about the new song's neighbours. Laying the page out for
   * "none" in that moment is what made it jump — one frame of full-width
   * cover with no shelf, then back to the shelf and a smaller cover.
   *
   * So the shape follows the last answer the query has (`useSimilar` keeps
   * it) until this song's arrives: a library whose songs have neighbours
   * keeps the shelf's place through the change, and one whose songs have none
   * never makes room for it. The cards, though, are only ever this song's —
   * the shelf holds its place empty rather than showing the song before's.
   */
  const similar = useSimilar(song?.id ?? null, 10)
  const similarSongs = similar.isPlaceholderData ? [] : (similar.data?.songs ?? [])
  const { artSize, showShelf } = similarShelfLayout({
    width,
    height,
    sidePadding: space.lg,
    similar: similar.data?.songs.length ?? null,
  })

  if (song === null) {
    return (
      <View style={[styles.screen, edges]}>
        <View style={styles.head}>
          <IconButton onPress={() => router.back()} label="Close now playing" round>
            <ChevronDown size={24} color={theme.colors.textSecondary} />
          </IconButton>
        </View>
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Nothing playing</Text>
          <Text style={styles.emptyText}>Start a song and it turns up here, with its lyrics.</Text>
        </View>
      </View>
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
    <Animated.View
      {...dismiss.panHandlers}
      style={[
        styles.shell,
        { backgroundColor: songColor.color, transform: [{ translateY: give }] },
      ]}
    >
      {/* The frame the page slides in: the song's colour too, so a pull shows no white above it. */}
      <Stack.Screen options={{ contentStyle: { backgroundColor: songColor.color } }} />
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
      <View style={[styles.screen, styles.screenOverBackdrop, edges]}>
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
            label={song.loved ? 'Unlike' : 'Like'}
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
                <PhoneSeek color={songColor.color} />
              </View>

              <View style={styles.controls}>
                <IconButton
                  onPress={player.toggleShuffle}
                  label={`Shuffle ${player.queue.shuffle ? 'on' : 'off'}`}
                  active={player.queue.shuffle}
                  round
                >
                  <Shuffle
                    size={19}
                    color={player.queue.shuffle ? songColor.color : theme.colors.textMuted}
                  />
                </IconButton>
                <IconButton onPress={player.previous} label="Previous" size={52} round>
                  <Prev size={30} color={theme.colors.textPrimary} />
                </IconButton>
                {/* The round white Play (`S2`): the page's one primary. */}
                <PlayButton
                  onPress={player.toggle}
                  label={player.isPlaying ? 'Pause' : 'Play'}
                  size={68}
                  icon={
                    <PlayPauseIcon
                      playing={player.isPlaying}
                      size={30}
                      color={theme.colors.onPrimary}
                    />
                  }
                />
                <IconButton onPress={player.next} label="Next" size={52} round>
                  <Next size={30} color={theme.colors.textPrimary} />
                </IconButton>
                <IconButton
                  onPress={player.cycleRepeatMode}
                  label={REPEAT_LABEL[player.queue.repeat]}
                  active={player.queue.repeat !== 'off'}
                  round
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

              {/*
                Under the lyrics the words have the room; the shelf is for the
                art. The slot is the height the cover gave up, held whether or
                not this song's neighbours have arrived yet, so the page does
                not shuffle itself about as they land.
              */}
              {showShelf && !showWords ? (
                <View style={styles.shelfSlot}>
                  {similarSongs.length > 0 ? <SimilarShelf songs={similarSongs} /> : null}
                </View>
              ) : null}
            </>
          )}
        </View>

        {/*
        Bare glyphs say nothing about what they open. Each is a labelled,
        finger-sized target — the same trade the tab bar makes.
      */}
        <View style={styles.foot}>
          <WordsFootAction
            song={song}
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
            // Speed lives in Practice, so a changed speed shows where it is changed.
            label={player.rate !== 1 ? `${player.rate}×` : 'Practice'}
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
              label={held ? 'Downloaded' : 'Download'}
              active={held}
              onPress={() => {
                // By hand, so a song removed by hand comes back, and mobile data is asked about.
                if (!held) requestDownload([song.id])
              }}
            />
          ) : null}
          <FootAction
            icon={
              <Moon
                size={19}
                color={sleepLeft !== null ? songColor.color : theme.colors.textMuted}
              />
            }
            label={sleepLeft ?? 'Sleep'}
            active={sleepLeft !== null}
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
      </View>
    </Animated.View>
  )
}

/**
 * The lyrics face on a phone: the song on one line with romaji or pinyin
 * beside it when the words can have them, and the same lyric view the
 * computer's page uses, sized for arm's length.
 *
 * A song with no lyrics shows its visual across the whole face instead, edge
 * to edge behind the song's name, and the romaji pill's place becomes the
 * style pill, which opens a sheet with the same choices as the computer's
 * "Style ▾".
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
  const visual = useSongVisual(song)
  const [styleOpen, setStyleOpen] = useState(false)
  const styleButtonRef = useRef<View>(null)
  const words = lyrics.words
  const noLyrics = words.status === 'missing' && !words.offline
  const sampler = useMotionSampler(song, noLyrics)
  const bpm = song.audioFeatures?.bpm
  const on = lyrics.romanizationOn
  const fontSize = Math.min(28, Math.max(22, width * 0.064))

  return (
    <>
      {noLyrics ? (
        <View pointerEvents="none" style={styles.wordsVisual}>
          <SongVisual song={song} kind={visual.kind} sampler={sampler} />
        </View>
      ) : null}
      <View style={styles.wordsHeadRow}>
        <Pressable
          style={[styles.wordsHead, styles.wordsHeadGrow]}
          onPress={onShowArt}
          accessibilityRole="button"
          accessibilityLabel="Show the artwork"
        >
          <Cover uri={artUri} title={song.album || song.title} size={44} />
          <View style={styles.wordsTitles}>
            <Text style={[styles.wordsTitle, noLyrics && styles.onVisual]} numberOfLines={1}>
              {song.title}
            </Text>
            <Text style={[styles.wordsArtist, noLyrics && styles.onVisualQuiet]} numberOfLines={1}>
              {song.artist || 'Unknown artist'}
              {noLyrics && bpm != null ? ` · ${Math.round(bpm)} BPM` : ''}
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
            <Romanize size={15} color={on ? theme.colors.onPrimary : theme.colors.textSecondary} />
            <Text style={[styles.toolText, on && styles.toolTextOn]}>
              {romanName(lyrics.language)}
            </Text>
          </Pressable>
        ) : noLyrics ? (
          <Pressable
            ref={styleButtonRef}
            onPress={() => setStyleOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`Style: ${visual.chosen ? '' : 'Auto, '}${VISUAL_NAMES[visual.kind]}`}
            style={[styles.tool, styles.toolOnVisual]}
          >
            <Text style={[styles.toolText, styles.onVisual]}>{VISUAL_NAMES[visual.kind]}</Text>
            <ChevronDown size={14} color="rgba(255, 255, 255, 0.85)" />
          </Pressable>
        ) : null}
      </View>
      <VisualStyleMenu
        open={styleOpen}
        onClose={() => setStyleOpen(false)}
        anchorRef={styleButtonRef}
        visual={visual}
        following={motionCaption(sampler.source)}
        onLookAgain={lyrics.lookAgain}
      />
      <View style={[styles.words, styles.wordsPadded]}>
        {words.status === 'lyrics' ? (
          <StageLyrics
            parsed={words.parsed}
            roman={words.roman}
            focus={false}
            fontSize={fontSize}
          />
        ) : noLyrics ? null : (
          <Text style={styles.wordsStatus}>
            {words.status === 'loading'
              ? 'Looking for lyrics…'
              : 'Lyrics need your library — they’ll show once it’s reachable.'}
          </Text>
        )}
      </View>
    </>
  )
}

/**
 * The scrubber, which is the only thing on the page that moves with the song.
 * It reads the position itself, so each tick redraws the scrubber and not the
 * blurred cover, the controls, the foot and the sheets around it.
 */
function PhoneSeek({ color }: { color: string }): ReactNode {
  const player = usePlayer()
  const progress = usePlayerProgress()
  return (
    <SeekBar
      loop={loopRegionPercent(player.loopA, player.loopB, progress.duration)}
      color={color}
      position={progress.position}
      duration={progress.duration}
      onSeek={player.seekTo}
    />
  )
}

/** Said as a sentence, because "Repeat: off" is not what a screen reader wants. */
const REPEAT_LABEL: Record<'off' | 'all' | 'one', string> = {
  off: 'Repeat off',
  all: 'Repeat all',
  one: 'Repeat this song',
}

/**
 * The foot's first button: Lyrics, or Visual for a song with no lyrics — the
 * same words the face it opens shows.
 */
function WordsFootAction({
  song,
  active,
  onPress,
}: {
  song: Song
  active: boolean
  onPress: () => void
}): ReactNode {
  const { theme } = useUnistyles()
  const artFor = useArt()
  const songColor = useSongColor(song, artFor(song))
  const { words } = useSongWords(song)
  const visual = words.status === 'missing' && !words.offline
  const color = active ? songColor.color : theme.colors.textMuted
  return (
    <FootAction
      icon={visual ? <Sparkles size={19} color={color} /> : <Mic size={19} color={color} />}
      label={visual ? 'Visual' : 'Lyrics'}
      active={active}
      onPress={onPress}
    />
  )
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
      {/* Six across a phone: "Downloaded" shrinks a little rather than losing its end. */}
      <Text
        style={[styles.actionLabel, active && { color: songColor.color }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.75}
      >
        {label}
      </Text>
    </Pressable>
  )
}

/**
 * The queue, over the stage.
 *
 * It starts at the song that is playing, as the computer's does: the played
 * songs fold into one line above it (`queueLines`), so there is nothing to
 * scroll past and no need to open part-way down. A tap plays that entry; the
 * X drops it. Dragging to reorder waits for a gesture library — a thumb on a
 * FlatList row is a scroll, and pretending otherwise makes both worse.
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
  const [playedOpen, setPlayedOpen] = useState(false)

  const upcoming = player.songs.slice(player.queue.index + 1)
  const remaining = upcoming.reduce((sum, song) => sum + song.duration, 0)
  const lines = queueLines(player.queue.index, player.songs.length, playedOpen)

  const renderItem: ListRenderItem<QueueLine> = ({ item: line }) => {
    if (line.kind === 'played') {
      return (
        <Pressable
          onPress={() => setPlayedOpen(open => !open)}
          accessibilityRole="button"
          accessibilityState={{ expanded: line.open }}
          accessibilityLabel={`${line.open ? 'Hide' : 'Show'} ${line.count} played ${line.count === 1 ? 'song' : 'songs'}`}
          style={({ pressed }) => [styles.queuePlayed, pressed && styles.actionPressed]}
        >
          {line.open ? (
            <ChevronDown size={15} color={theme.colors.textMuted} />
          ) : (
            <ChevronRight size={15} color={theme.colors.textMuted} />
          )}
          <Text style={styles.queuePlayedText}>Played · {line.count}</Text>
        </Pressable>
      )
    }
    if (line.kind === 'upNext') {
      return <Text style={styles.queueUpNext}>{upNextLine(upcoming.length, remaining)}</Text>
    }
    const index = line.index
    const item = player.songs[index]
    if (!item) return null
    const isCurrent = index === player.queue.index
    const isPast = index < player.queue.index
    return (
      <View style={[styles.queueRow, isCurrent && styles.queueRowCurrent]}>
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
          <Text style={styles.queueHeading}>Queue</Text>
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
        data={lines}
        keyExtractor={line =>
          line.kind === 'song' ? `${player.songs[line.index]?.id ?? 0}-${line.index}` : line.kind
        }
        renderItem={renderItem}
        initialNumToRender={14}
        contentContainerStyle={styles.queueList}
      />
    </View>
  )
}

const QUEUE_ROW = 52
/** How far a pull down must travel to put the page away, or how far a quick flick. */
const DISMISS_DISTANCE = 140
const DISMISS_VELOCITY = 0.9

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
    ...label(theme.colors),
    flex: 1,
    textAlign: 'center',
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
    borderRadius: radius.card,
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
  // The song's name is the display face, which carries its own weight.
  title: {
    color: theme.colors.textPrimary,
    fontFamily: fonts.display,
    fontSize: type.large,
    lineHeight: 27,
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
  // The whole face and out to the screen's sides, behind the song's name.
  wordsVisual: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: -space.lg,
    right: -space.lg,
  },
  // Light on the visual's dark ground, in either theme.
  onVisual: { color: '#ffffff' },
  onVisualQuiet: { color: 'rgba(255, 255, 255, 0.72)' },
  toolOnVisual: { backgroundColor: 'rgba(255, 255, 255, 0.16)' },
  tool: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 11,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.surface2,
  },
  toolOn: { backgroundColor: theme.colors.textPrimary },
  toolText: { color: theme.colors.textSecondary, fontSize: 12, fontWeight: '600' },
  toolTextOn: { color: theme.colors.onPrimary },
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
  // Exactly what `similarShelfLayout` took off the cover for it.
  shelfSlot: {
    height: SIMILAR_SHELF_HEIGHT,
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
  practiceSheet: { height: 560 },
  foot: {
    flexDirection: 'row',
    gap: 2,
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
    borderRadius: radius.pill,
  },
  actionPressed: {
    backgroundColor: withAlpha(theme.colors.textPrimary, 0.08),
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
  },
  queueTitles: {
    flex: 1,
    minWidth: 0,
  },
  queueHeading: sectionTitle(theme.colors),
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
  queuePlayed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: HIT_TARGET,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
  },
  queuePlayedText: { color: theme.colors.textMuted, fontSize: type.small, fontWeight: '500' },
  queueUpNext: {
    ...label(theme.colors),
    paddingTop: 10,
    paddingBottom: 4,
    paddingHorizontal: 10,
  },
  queueRow: {
    height: QUEUE_ROW,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.cover,
    paddingRight: 2,
  },
  // The song playing is a step up in tone, and its equaliser says which it is.
  queueRowCurrent: { backgroundColor: theme.colors.surface2 },
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
