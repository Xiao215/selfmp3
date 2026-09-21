import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Animated,
  Image,
  PanResponder,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { Song } from '@selfmp3/shared'
import {
  fonts,
  HIT_TARGET,
  isDownloaded,
  loopRegionPercent,
  radius,
  space,
  type,
  useLibrary,
  useToggleLoved,
  withAlpha,
} from '@selfmp3/client'
import { useDownloads } from '../../offline/DownloadsProvider'
import { usePlayer, usePlayerProgress } from '../../player/PlayerProvider'
import { useSongColor } from '../../ui/useSongColor'
import { spring, timing, useEntrance } from '../../ui/motion'
import { modalCoversScreen } from '../../ports/modalCoversScreen'
import { Button, PlayButton } from '../../ui/components/Button'
import { Chip } from '../../ui/components/Chip'
import { Cover } from '../../ui/components/Cover'
import { IconButton } from '../../ui/components/IconButton'
import {
  ChevronDown,
  CloudDownload,
  Devices,
  Downloaded,
  Heart,
  Info,
  Metronome,
  More,
  Next,
  Plus,
  Prev,
  Queue,
  Repeat,
  RepeatOne,
  Romanize,
  Shuffle,
} from '../../ui/components/Icons'
import { PlayPauseIcon } from '../../ui/components/PlayPauseIcon'
import { SeekBar } from '../../ui/components/SeekBar'
import { Sheet, SheetItem } from '../../ui/components/Sheet'
import { SleepMenu, useSleepMinutesLeft } from '../../ui/components/SleepMenu'
import { TagPicker } from '../../ui/components/TagPicker'
import { label } from '../../ui/surfaces'
import { useArt } from '../../offline/useArt'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { OverlayProvider } from '../../shell/Overlay'
import { useLayout } from '../../shell/useLayout'
import { DevicesSheet } from '../devices/DevicesSheet'
import { PracticePanel } from '../practice/PracticePanel'
import { openQueueSheet } from '../queue/queueSheet.store'
import { songLink } from '../song/song.model'
import { tagLink } from '../tag/placeLinks'
import { ArtistLinks } from './ArtistLinks'
import { NowPlayingStage } from './NowPlayingStage'
import {
  BREATH_MS,
  parseView,
  PAUSED_COVER_SCALE,
  romanName,
  swipeOutcome,
  type PhoneView,
} from './nowPlaying.model'
import { SongVisual } from './SongVisual'
import type { MotionSampler } from './motionSource.model'
import { StageLyrics } from './StageLyrics'
import { TaggingLine } from './TaggingLine'
import { useMotionSampler } from './useMotionSampler'
import { useSongWords } from './useSongWords'
import { useTagging } from './useTagging'
import { useSongVisual, type SongVisualChoice } from './visualChoice'
import { motionCaption, VISUAL_NAMES } from './visuals.model'
import { VisualStyleMenu } from './VisualStyleMenu'

/**
 * Now Playing: the computer's stage, or the phone's own full-screen page.
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
  const player = usePlayer()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const song = player.current

  if (song === null) {
    return (
      <View
        style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
        accessibilityLabel="Now playing"
      >
        <View style={styles.head}>
          <IconButton onPress={() => router.back()} label="Close now playing" filled>
            <ChevronDown size={22} color={theme.colors.textPrimary} />
          </IconButton>
        </View>
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Nothing playing</Text>
          <Text style={styles.emptyText}>Start a song and it turns up here, with its lyrics.</Text>
        </View>
      </View>
    )
  }
  return <PhonePage song={song} />
}

/**
 * The full-screen phone player (docs/ui-mock `P21`, `P22`).
 *
 * Two views of one route. The cover: a header with the way down and ⓘ, the
 * cover that breathes with play and pause, the song and its tags, the
 * scrubber and the transport, and a foot of three — Lyrics, Sleep and the
 * queue. The words (`?view=lyrics`): the lyrics fill the page under a small
 * header, with the scrubber and the transport kept, so reading along never
 * costs the skip. A song with no lyrics shows its visual there instead.
 *
 * A pull up on the cover opens the words and a pull down on the words goes
 * back; a pull down on the cover puts the page away, as Apple Music's does.
 */
function PhonePage({ song }: { song: Song }): ReactNode {
  const { theme } = useUnistyles()
  const artFor = useArt()
  const backdropFor = useArt(ROW_COVER_SIZE)
  const router = useRouter()
  const { view: viewParam } = useLocalSearchParams<{ view?: string }>()
  const view = parseView(viewParam)
  const uri = artFor(song)
  /*
   * The blurred page behind everything is drawn from a small cover on purpose.
   * `blurRadius` on iOS is a blur of the decoded image, so blurring the full
   * 640 costs the most of anything on this page — and a 60-point blur of a
   * 128-pixel source, stretched to fill, looks the same.
   */
  const backdropUri = backdropFor(song)
  const songColor = useSongColor(song, uri)
  const lyrics = useSongWords(song)
  const words = lyrics.words
  // Not while offline: the words may exist, and there is text to say why they are not here.
  const noLyrics = words.status === 'missing' && !words.offline
  const showVisual = noLyrics && view === 'lyrics'
  const sampler = useMotionSampler(song, showVisual)
  const visual = useSongVisual(song)

  const [sleepOpen, setSleepOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [practiceOpen, setPracticeOpen] = useState(false)
  const [devicesOpen, setDevicesOpen] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  // Play-and-tag, from All tags' untagged card: the tag editor up for each song in turn.
  const tagging = useTagging()

  const setView = (next: PhoneView): void => {
    router.setParams({ view: next === 'lyrics' ? 'lyrics' : undefined })
  }
  const close = (): void => router.back()
  // The song's own page is a page of the app, not of this modal: the modal
  // goes down first, so back from the song lands where Now Playing was opened.
  const openSong = (): void => {
    if (router.canGoBack()) router.back()
    router.push(songLink(song.id))
  }

  // The view that just came in rises into place from the side it came from.
  const [enter] = useState(() => new Animated.Value(1))
  const shownView = useRef(view)
  useEffect(() => {
    if (shownView.current === view) return
    shownView.current = view
    enter.setValue(0)
    spring(enter, 1)
  }, [view, enter])
  const viewStyle = {
    opacity: enter,
    transform: [
      {
        translateY: enter.interpolate({
          inputRange: [0, 1],
          outputRange: [view === 'lyrics' ? 48 : -48, 0],
        }),
      },
    ],
  }

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

  // A long pull puts the page away or turns it (`swipeOutcome`). Asked only on
  // a move, so taps, the scrubber (which refuses to let go) and the scrolling
  // lyrics keep their own touches; on the words only a pull down is asked for,
  // since up is how they scroll. The page gives a little under the finger
  // rather than following it: putting it away is the modal's own slide, the
  // one the chevron plays, so the two feel alike.
  const [pull] = useState(() => new Animated.Value(0))
  const give = pull.interpolate({
    inputRange: [-600, 0, 600],
    outputRange: [-150, 0, 150],
    extrapolate: 'clamp',
  })
  // Opening (docs/ui-mock `M2`, 1): on a phone the native modal slides the page
  // up. In a browser the route is a page in the content area with no move of
  // its own, so it rises from the foot itself, on the spring.
  const window = useWindowDimensions()
  const arrival = useEntrance()
  const lift = modalCoversScreen
    ? give
    : Animated.add(
        give,
        arrival.interpolate({ inputRange: [0, 1], outputRange: [window.height, 0] }),
      )
  const pan = useMemo(() => {
    const settle = (): void => void spring(pull, 0)
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) =>
        Math.abs(gesture.dy) > 12 &&
        Math.abs(gesture.dy) > Math.abs(gesture.dx) * 2 &&
        (view === 'cover' || gesture.dy > 0),
      onPanResponderMove: (_event, gesture) =>
        pull.setValue(view === 'cover' ? gesture.dy : Math.max(0, gesture.dy)),
      onPanResponderRelease: (_event, gesture) => {
        const outcome = swipeOutcome({ view, dy: gesture.dy, vy: gesture.vy })
        settle()
        if (outcome === 'close') router.back()
        else if (outcome === 'lyrics') router.setParams({ view: 'lyrics' })
        else if (outcome === 'cover') router.setParams({ view: undefined })
      },
      onPanResponderTerminate: settle,
    })
  }, [pull, router, view])

  return (
    <Animated.View
      {...pan.panHandlers}
      style={[
        styles.shell,
        { backgroundColor: songColor.color, transform: [{ translateY: lift }] },
      ]}
    >
      {/* The frame the page slides in: the song's colour too, so a pull shows no white above it. */}
      <Stack.Screen options={{ contentStyle: { backgroundColor: songColor.color } }} />
      {/*
        The cover itself, blurred across the whole page behind everything: the
        computer's stage glow, which a phone cannot draw with a CSS filter. A
        song with no cover is washed in its tile's colour instead.
      */}
      <View pointerEvents="none" style={styles.fill}>
        {uri ? (
          <Image
            source={{ uri: backdropUri ?? uri }}
            blurRadius={60}
            resizeMode="cover"
            style={styles.backdropImage}
          />
        ) : null}
        <View
          style={[
            styles.fill,
            { backgroundColor: withAlpha(theme.colors.surface0, view === 'lyrics' ? 0.7 : 0.56) },
          ]}
        />
      </View>
      <Animated.View style={[styles.screen, styles.overBackdrop, edges, viewStyle]}>
        {view === 'cover' ? (
          <CoverView
            song={song}
            uri={uri}
            color={songColor.color}
            noLyrics={noLyrics}
            tagging={tagging.on ? { line: tagging.line, stop: tagging.stop } : null}
            onClose={close}
            onOpenSong={openSong}
            onLyrics={() => setView('lyrics')}
            onTags={() => (tagging.on ? tagging.raise() : setTagsOpen(true))}
            onSleep={() => setSleepOpen(true)}
            onMore={() => setMoreOpen(true)}
            opening={arrival}
          />
        ) : (
          <WordsView
            song={song}
            uri={uri}
            lyrics={lyrics}
            noLyrics={noLyrics}
            visual={visual}
            sampler={sampler}
            following={motionCaption(sampler.source)}
            onBack={() => setView('cover')}
          />
        )}
      </Animated.View>

      <MoreSheet
        song={song}
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        onPractice={() => setPracticeOpen(true)}
        onDevices={() => setDevicesOpen(true)}
      />
      <Sheet open={practiceOpen} onClose={() => setPracticeOpen(false)} testID="practice-sheet">
        <View style={styles.practiceSheet}>
          <PracticePanel onClose={() => setPracticeOpen(false)} />
        </View>
      </Sheet>
      <SleepMenu open={sleepOpen} onClose={() => setSleepOpen(false)} />
      <DevicesSheet open={devicesOpen} onClose={() => setDevicesOpen(false)} />
      {/*
        A sheet from the foot of the page, as the picker is on a phone: the
        cover and the head, with the tagging line in it, stay in sight above it.
      */}
      <TagPicker
        song={tagsOpen || tagging.open ? song : null}
        onClose={() => {
          setTagsOpen(false)
          if (tagging.open) tagging.close()
        }}
      />
    </Animated.View>
  )
}

/** The cover view (`P21`). */
function CoverView({
  song,
  uri,
  color,
  noLyrics,
  tagging,
  onClose,
  onOpenSong,
  onLyrics,
  onTags,
  onSleep,
  onMore,
  opening,
}: {
  song: Song
  uri: string | null
  color: string
  noLyrics: boolean
  /** The page opening, 0 to 1; already 1 by the time the words have been and gone. */
  opening: Animated.Value
  tagging: { line: string; stop: () => void } | null
  onClose: () => void
  onOpenSong: () => void
  onLyrics: () => void
  onTags: () => void
  onSleep: () => void
  onMore: () => void
}): ReactNode {
  const { theme } = useUnistyles()
  const player = usePlayer()
  const router = useRouter()
  const library = useLibrary()
  const toggleLoved = useToggleLoved()
  // While the timer runs the Sleep pill says how long is left, not just "Sleep".
  const sleepLeft = useSleepMinutesLeft(player.sleepTimerEndsAt)
  const tags = (library.data?.tags ?? []).filter(tag => song.tagIds.includes(tag.id))

  return (
    <>
      <View style={styles.head}>
        <IconButton onPress={onClose} label="Close now playing" filled>
          <ChevronDown size={22} color={theme.colors.textPrimary} />
        </IconButton>
        {/* Play-and-tag takes the head's line: at the top, it stays clear of the editor's sheet. */}
        {tagging ? (
          <TaggingLine line={tagging.line} onStop={tagging.stop} center />
        ) : (
          <Text style={styles.headLabel} numberOfLines={1}>
            Now playing
          </Text>
        )}
        <IconButton onPress={onOpenSong} label="About this song" filled testID="now-playing-info">
          <Info size={20} color={theme.colors.textPrimary} />
        </IconButton>
      </View>

      <BreathingCover song={song} uri={uri} onPress={onLyrics} opening={opening} />

      <View style={styles.titleRow}>
        <View style={styles.titles}>
          <Text style={styles.title} numberOfLines={1}>
            {song.title}
          </Text>
          <Text style={styles.artist} numberOfLines={1}>
            <ArtistLinks artist={song.artist} />
          </Text>
        </View>
        <IconButton
          onPress={() => toggleLoved.mutate({ id: song.id, loved: !song.loved })}
          label={song.loved ? 'Unlike' : 'Like'}
          active={song.loved}
          filled
        >
          <Heart
            size={20}
            filled={song.loved}
            color={song.loved ? theme.colors.danger : theme.colors.textPrimary}
          />
        </IconButton>
      </View>

      {/* The song's tags, quietly: each chip is a door to its tag, and + adds one. */}
      <View style={styles.tags}>
        {tags.map(tag => (
          <Chip
            key={tag.id}
            label={tag.name}
            hue={tag.hue}
            selected={false}
            compact
            onPress={() => router.navigate(tagLink(tag.name))}
          />
        ))}
        <Pressable
          onPress={onTags}
          accessibilityRole="button"
          accessibilityLabel={tags.length > 0 ? 'Edit tags' : 'Add a tag'}
          hitSlop={8}
          style={({ pressed }) => [styles.addTag, pressed && styles.addTagPressed]}
        >
          <Plus size={13} color={theme.colors.textSecondary} />
        </Pressable>
      </View>

      <View style={styles.progress}>
        <PhoneSeek color={color} />
      </View>

      <View style={styles.controls}>
        <IconButton
          onPress={player.toggleShuffle}
          label={`Shuffle ${player.queue.shuffle ? 'on' : 'off'}`}
          active={player.queue.shuffle}
        >
          <Shuffle size={19} color={player.queue.shuffle ? color : theme.colors.textSecondary} />
        </IconButton>
        <IconButton onPress={player.previous} label="Previous" size={52}>
          <Prev size={32} color={theme.colors.textPrimary} />
        </IconButton>
        {/* The round white Play (`S2`): the page's one primary. */}
        <PlayButton
          onPress={player.toggle}
          label={player.isPlaying ? 'Pause' : 'Play'}
          size={72}
          icon={
            <PlayPauseIcon playing={player.isPlaying} size={30} color={theme.colors.onPrimary} />
          }
        />
        <IconButton onPress={player.next} label="Next" size={52}>
          <Next size={32} color={theme.colors.textPrimary} />
        </IconButton>
        <IconButton
          onPress={player.cycleRepeatMode}
          label={REPEAT_LABEL[player.queue.repeat]}
          active={player.queue.repeat !== 'off'}
        >
          {player.queue.repeat === 'one' ? (
            <RepeatOne size={19} color={color} />
          ) : (
            <Repeat
              size={19}
              color={player.queue.repeat === 'off' ? theme.colors.textSecondary : color}
            />
          )}
        </IconButton>
      </View>

      {/*
        The foot: the two views' marks, then Lyrics · Sleep · Up next. Practice,
        Download and Devices are one step further, under ⋯, since the page
        keeps its foot to three.
      */}
      <View style={styles.foot}>
        <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no">
          <View style={[styles.dot, styles.dotOn]} />
          <View style={styles.dot} />
        </View>
        <View style={styles.footRow}>
          <Button label={noLyrics ? 'Visual' : 'Lyrics'} onPress={onLyrics} />
          <Button label={sleepLeft ?? 'Sleep'} active={sleepLeft !== null} onPress={onSleep} />
          <Button
            icon={<Queue size={19} color={theme.colors.textPrimary} />}
            accessibilityLabel="Up next"
            testID="now-playing-queue"
            onPress={openQueueSheet}
          />
          <Button
            icon={<More size={19} color={theme.colors.textPrimary} />}
            accessibilityLabel="More"
            testID="now-playing-more"
            onPress={onMore}
          />
        </View>
      </View>
    </>
  )
}

/** How small the cover starts as the page opens, before it grows into place. */
const COVER_OPENS_AT = 0.6

/**
 * The cover, which breathes (`M1`, move 5): smaller while paused and full size
 * playing, so the page says which it is without a glyph being read. Tapping
 * it opens the words, as a pull up does.
 *
 * It takes whatever height the page leaves it, so on a short phone it is the
 * cover that gives way and nothing below it is pushed off the bottom.
 */
function BreathingCover({
  song,
  uri,
  onPress,
  opening,
}: {
  song: Song
  uri: string | null
  onPress: () => void
  opening: Animated.Value
}): ReactNode {
  const player = usePlayer()
  // The app's own width, not the window's (`shell/rootWidth.ts`).
  const { width } = useLayout()
  const [room, setRoom] = useState<{ width: number; height: number } | null>(null)
  const size = Math.max(
    120,
    Math.floor(room ? Math.min(room.width, room.height) : Math.min(width - space.lg * 2, 342)),
  )

  const [breath] = useState(() => new Animated.Value(player.isPlaying ? 1 : PAUSED_COVER_SCALE))
  useEffect(() => {
    timing(breath, player.isPlaying ? 1 : PAUSED_COVER_SCALE, BREATH_MS)
  }, [player.isPlaying, breath])
  // As the page opens the cover grows into its place (`M2`, 1): the nearest
  // this app comes to the board's cover travelling up from the mini player,
  // which would need shared elements it does not have.
  const scale = useMemo(
    () =>
      Animated.multiply(
        breath,
        opening.interpolate({ inputRange: [0, 1], outputRange: [COVER_OPENS_AT, 1] }),
      ),
    [breath, opening],
  )

  return (
    <View
      style={styles.art}
      onLayout={event => {
        const { width: w, height: h } = event.nativeEvent.layout
        setRoom(current =>
          current?.width === w && current.height === h ? current : { width: w, height: h },
        )
      }}
    >
      <Animated.View style={[styles.artShadow, { transform: [{ scale }] }]}>
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel="Show the lyrics"
        >
          <Cover uri={uri} title={song.album || song.title} size={size} />
        </Pressable>
      </Animated.View>
    </View>
  )
}

/**
 * The words alone (`P22`): a small header with the way back, the song and the
 * romaji or pinyin switch; the lyrics across the page; and the scrubber and
 * the transport under them. A song with no lyrics puts its visual (`P23`,
 * `P24`) in the same place the words would have had, so the page reads the
 * same either way, and the switch's place is its look, which opens the same
 * choices as the computer's.
 */
function WordsView({
  song,
  uri,
  lyrics,
  noLyrics,
  visual,
  sampler,
  following,
  onBack,
}: {
  song: Song
  uri: string | null
  lyrics: ReturnType<typeof useSongWords>
  noLyrics: boolean
  visual: SongVisualChoice
  sampler: MotionSampler
  following: string
  onBack: () => void
}): ReactNode {
  const { theme } = useUnistyles()
  const player = usePlayer()
  // The app's own width, not the window's (`shell/rootWidth.ts`).
  const { width } = useLayout()
  const [styleOpen, setStyleOpen] = useState(false)
  const styleButtonRef = useRef<View>(null)
  const words = lyrics.words
  const on = lyrics.romanizationOn
  const fontSize = Math.min(28, Math.max(22, width * 0.064))

  return (
    <View style={styles.wordsView} testID="now-playing-lyrics-view">
      <View style={styles.wordsHead}>
        <IconButton onPress={onBack} label="Back to the cover" filled>
          <ChevronDown size={22} color={theme.colors.textPrimary} />
        </IconButton>
        <Cover uri={uri} title={song.album || song.title} size={40} />
        <View style={styles.wordsTitles}>
          <Text style={styles.wordsTitle} numberOfLines={1}>
            {song.title}
          </Text>
          <Text style={styles.wordsArtist} numberOfLines={1}>
            {song.artist || 'Unknown artist'}
          </Text>
        </View>
        {words.status === 'lyrics' && lyrics.language !== 'none' ? (
          <Pressable
            role="button"
            aria-pressed={on}
            onPress={() => lyrics.setRomanization(!on)}
            style={[styles.tool, on && styles.toolOn]}
          >
            <Romanize size={15} color={on ? theme.colors.onPrimary : theme.colors.textPrimary} />
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
            style={styles.tool}
          >
            <Text style={styles.toolText}>{VISUAL_NAMES[visual.kind]}</Text>
            <ChevronDown size={14} color={theme.colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>
      <VisualStyleMenu
        open={styleOpen}
        onClose={() => setStyleOpen(false)}
        anchorRef={styleButtonRef}
        visual={visual}
        following={following}
        onLookAgain={lyrics.lookAgain}
      />

      {noLyrics ? (
        <View pointerEvents="none" style={styles.visualPanel}>
          <SongVisual song={song} kind={visual.kind} sampler={sampler} cover={uri} rounded />
        </View>
      ) : (
        <View style={styles.words}>
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
                : 'Lyrics need your library — they’ll show once it’s reachable.'}
            </Text>
          )}
        </View>
      )}

      <View style={styles.progress}>
        <PhoneSeek color={theme.colors.textPrimary} />
      </View>
      <View style={styles.wordsControls}>
        <IconButton onPress={player.previous} label="Previous">
          <Prev size={28} color={theme.colors.textPrimary} />
        </IconButton>
        <PlayButton
          onPress={player.toggle}
          label={player.isPlaying ? 'Pause' : 'Play'}
          size={60}
          icon={
            <PlayPauseIcon playing={player.isPlaying} size={26} color={theme.colors.onPrimary} />
          }
        />
        <IconButton onPress={player.next} label="Next">
          <Next size={28} color={theme.colors.textPrimary} />
        </IconButton>
      </View>
    </View>
  )
}

/**
 * What the ⋯ at the foot holds: the tools that used to stand in it. Practice
 * (with the speed on it when it is not 1×), keeping the song on this phone in
 * the installed app, and the devices to play on.
 */
function MoreSheet({
  song,
  open,
  onClose,
  onPractice,
  onDevices,
}: {
  song: Song
  open: boolean
  onClose: () => void
  onPractice: () => void
  onDevices: () => void
}): ReactNode {
  const { theme } = useUnistyles()
  const player = usePlayer()
  const { state: downloads, requestDownload, installed } = useDownloads()
  const held = isDownloaded(downloads.index, song.id)
  const then = (next: () => void) => (): void => {
    onClose()
    next()
  }
  return (
    <Sheet open={open} onClose={onClose} title={song.title} testID="now-playing-more-sheet">
      <SheetItem
        icon={<Metronome size={18} color={theme.colors.textSecondary} />}
        label="Practice"
        detail={player.rate !== 1 || player.loopB !== null ? `${player.rate}×` : undefined}
        onPress={then(onPractice)}
      />
      {installed ? (
        <SheetItem
          icon={
            held ? (
              <Downloaded
                size={18}
                color={theme.colors.textSecondary}
                knockout={theme.colors.surface1}
              />
            ) : (
              <CloudDownload size={18} color={theme.colors.textSecondary} />
            )
          }
          label={held ? 'Downloaded' : 'Download'}
          disabled={held}
          // By hand, so a song removed by hand comes back, and mobile data is asked about.
          onPress={then(() => requestDownload([song.id]))}
        />
      ) : null}
      <SheetItem
        icon={<Devices size={18} color={theme.colors.textSecondary} />}
        label="Devices"
        onPress={then(onDevices)}
      />
    </Sheet>
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

const styles = StyleSheet.create(theme => ({
  shell: { flex: 1 },
  screen: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
    paddingHorizontal: space.lg,
  },
  overBackdrop: { backgroundColor: 'transparent' },
  fill: {
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
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingTop: space.sm,
    marginHorizontal: -space.xs,
  },
  headLabel: {
    ...label(theme.colors),
    flex: 1,
    textAlign: 'center',
  },
  art: {
    flex: 1,
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.lg,
  },
  artShadow: {
    borderRadius: radius.card,
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 18 },
    elevation: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  titles: { flex: 1, minWidth: 0, gap: 3 },
  // The song's name is the display face, which carries its own weight.
  title: {
    color: theme.colors.textPrimary,
    fontFamily: fonts.display,
    fontSize: type.large,
    lineHeight: 29,
    letterSpacing: -0.3,
  },
  artist: {
    color: theme.colors.textSecondary,
    fontSize: 15,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: space.md,
  },
  // The add chip, round: a place a tag will go, drawn by its dashed edge (`S2`).
  addTag: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.colors.borderStrong,
  },
  addTagPressed: { backgroundColor: withAlpha(theme.colors.textPrimary, 0.1) },
  progress: {
    marginTop: space.lg,
    marginBottom: 6,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xs,
  },
  foot: {
    alignItems: 'center',
    gap: space.md,
    paddingTop: space.lg,
    paddingBottom: space.sm,
  },
  // Which of the page's two views this is: a quiet mark that the words are a pull away.
  dots: { flexDirection: 'row', gap: 6 },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: withAlpha(theme.colors.textPrimary, 0.35),
  },
  dotOn: { width: 18, backgroundColor: theme.colors.textPrimary },
  footRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  practiceSheet: { height: 560 },
  wordsView: { flex: 1, minHeight: 0 },
  wordsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingTop: space.sm,
    minHeight: HIT_TARGET + space.sm,
  },
  wordsTitles: { flex: 1, minWidth: 0, gap: 1 },
  wordsTitle: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  wordsArtist: {
    color: theme.colors.textSecondary,
    fontSize: 12,
  },
  words: {
    flex: 1,
    minHeight: 0,
    marginTop: space.md,
    marginHorizontal: -space.lg,
    paddingHorizontal: space.lg - 6,
  },
  visualPanel: {
    flex: 1,
    minHeight: 0,
    marginTop: space.md,
    marginBottom: space.md,
    borderRadius: radius.cardLg,
    overflow: 'hidden',
  },
  wordsStatus: { color: theme.colors.textMuted, fontSize: 13, textAlign: 'center', marginTop: 40 },
  wordsControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 26,
    paddingBottom: space.sm,
  },
  tool: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    backgroundColor: withAlpha(theme.colors.textPrimary, 0.12),
  },
  toolOn: { backgroundColor: theme.colors.textPrimary },
  toolText: { color: theme.colors.textPrimary, fontSize: 12, fontWeight: '600' },
  toolTextOn: { color: theme.colors.onPrimary },
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
