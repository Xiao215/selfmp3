import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Image, PanResponder, Text, useWindowDimensions, View } from 'react-native'
import { Guide, riseWith } from '../guide/Guide'
import { useGuide, type GuideHandle, type GuideTarget } from '../guide/useGuide'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { Song } from '@selfmp3/shared'
import { artistOr } from '@selfmp3/shared'
import { radius, space, type, useLibrary, withAlpha, iconSize } from '@selfmp3/client'
import { useRoom } from '../room/room.store'
import { describeSource } from '../lists/lists.model'
import { RoomSheets } from '../room/RoomSheets'
import { ShareSheet } from '../share/ShareSheet'
import { RoomPill, TogetherButton } from '../room/Together'
import { usePlayer, usePlayerPlaying } from '../../player/PlayerProvider'
import { useSongColor } from '../../ui/useSongColor'
import { ease, motionMs, nativeDriver, spring, timing, useEntrance } from '../../ui/motion'
import { MOVE_MS, PULL } from '../../ui/motion.model'
import { takeCoverHandoff, type CoverFrame } from '../../ui/coverHandoff'
import { pageFootNow, setPageFoot, usePageFoot } from '../../shell/pageFoot'
import { setStageExit } from '../../shell/stageExit'
import { Cover } from '../../ui/components/Cover'
import { IconButton } from '../../ui/components/IconButton'
import { ChevronDown, Moon, More, UpNext } from '../../ui/components/Icons'
import { HeadPill } from '../../ui/components/HeadPill'
import { LikeButton } from '../../ui/components/LikeButton'
import { SeekBar } from '../../ui/components/SeekBar'
import { SleepMenu, useSleepTimerStatus } from '../../ui/components/SleepMenu'
import { SongMenu } from '../../ui/components/SongMenu'
import { useTouchTravel } from '../../ui/useTouchTravel'
import { TransportControls } from '../../ui/components/TransportControls'
import { TagPicker } from '../../ui/components/TagPicker'
import { artShadow, heroTitle } from '../../ui/surfaces'
import { useArt } from '../../offline/useArt'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { OverlayProvider } from '../../shell/Overlay'
import { modalCoversScreen } from '../../ports/modalCoversScreen'
import { ToastHost } from '../../ui/components/ToastHost'
import { useLayout, useLayoutFlags } from '../../shell/useLayout'
import { DevicesSheet } from '../devices/DevicesSheet'
import { QueueSheet } from '../queue/QueueSheet'
import { openQueueSheet } from '../queue/queueSheet.store'
import { ArtistLinks } from './ArtistLinks'
import { leaveTo, putAway } from './leaveNowPlaying'
import { EmptyNowPlaying } from './EmptyNowPlaying'
import { canRomanize, FindLyricsButton, RomanizeButton } from './LyricsTools'
import { SongTagsLine } from './SongTagsLine'
import { useNowPlayingSong } from './useNowPlayingSong'
import { NowPlayingStage } from './NowPlayingStage'
import {
  backdropVeil,
  isVerticalPull,
  parseView,
  PAUSED_COVER_SCALE,
  swipeOutcome,
  type PhoneView,
} from './nowPlaying.model'
import { useShownScheme } from '../../ui/theme/unistyles'
import { TaggingLine } from './TaggingLine'
import { useLineMenu } from './useLineMenu'
import { useSongWords } from './useSongWords'
import { useTagEditor, useTagging } from './useTagging'
import { Press } from '../../ui/components/Press'
import { countUse } from '../usage/usage'
import { useViewPresence, VIEW_TRAVEL } from './useViewPresence'
import { LYRICS_GUIDE_STEPS, PhoneWordsBody, PhoneWordsHead } from './PhoneWords'
import { TouchFlag } from '../../ui/touchFlag'

/**
 * Now Playing: the computer's stage, or the phone's own full-screen page.
 */
export function NowPlayingScreen(): ReactNode {
  const { wide } = useLayoutFlags()
  const player = usePlayer()
  const router = useRouter()
  const { song: songParam } = useLocalSearchParams<{ song?: string }>()
  const songId = player.current?.id
  useEffect(() => countUse('now-playing'), [])
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
  // never showed (Sleep, Devices, the song menu). So the phone's page has a host of
  // its own, inside the modal. Up next and the toasts are the shell's own
  // rather than overlays, and they come here for the same reason: the foot's
  // Up next opened a sheet nobody could see (`Shell`'s `covered`). In a
  // browser the page is inside the shell, whose own are drawn over it.
  return wide ? (
    <NowPlayingStage />
  ) : (
    <OverlayProvider>
      <PhoneNowPlaying />
      {modalCoversScreen ? <OverTheModal /> : null}
    </OverlayProvider>
  )
}

/**
 * Up next, a room's sheets, the share sheet and the toast row, drawn inside
 * the modal while it covers the shell: the sheets over the page's foot, and
 * the toasts after them so a removal's Undo is over the sheet that asked for
 * it. The shell's toast row is still there under the page, with the resume
 * offer that is decided once per launch; this is just the messages.
 */
function OverTheModal(): ReactNode {
  const insets = useSafeAreaInsets()
  // Above the page's scrubber and transport, which a toast at the foot covered
  // — a failure, which stays until it is dismissed, kept Next from being pressed.
  const foot = usePageFoot()
  const router = useRouter()
  const go = useCallback((href: Href) => leaveTo(router, href), [router])
  return (
    <>
      <QueueSheet go={go} />
      <RoomSheets go={go} />
      <ShareSheet />
      <View
        pointerEvents="box-none"
        style={[styles.toasts, { bottom: Math.max(insets.bottom, foot) + space.sm }]}
      >
        <ToastHost />
      </View>
    </>
  )
}

function PhoneNowPlaying(): ReactNode {
  const router = useRouter()
  const { song, onRemove, removeDialog } = useNowPlayingSong()
  return (
    <>
      {song === null ? (
        <EmptyNowPlaying onClose={() => putAway(router)} />
      ) : (
        <PhonePage song={song} onRemove={onRemove} />
      )}
      {removeDialog}
    </>
  )
}

/**
 * The full-screen phone player (docs/ui-mock `P21`, `P22`).
 *
 * Two views of one route. The cover: a header with the way down, where the
 * music came from ("From Library", "From night") and Up next, the cover that
 * breathes with play and pause, the song on a line of its own (two, if its
 * name needs them) with its heart and ⋯ beside it, its tags, then the
 * scrubber and the transport, low where a thumb is. The sleep timer and Song
 * details are under ⋯ (D1, 2026-10-25), and while a timer runs the header says
 * so in place of where the music came from. The words (`?view=lyrics`): the lyrics fill the page under a small
 * header, with the scrubber and the transport kept, so reading along never
 * costs the skip. A song with no lyrics says so there; a phone has no visual.
 *
 * A pull up on the cover opens the words and a pull down on the words goes
 * back; a pull down on the cover puts the page away, as Apple Music's does.
 */
function PhonePage({ song, onRemove }: { song: Song; onRemove: (song: Song) => void }): ReactNode {
  const { theme } = useUnistyles()
  const scheme = useShownScheme()
  const artFor = useArt()
  const backdropFor = useArt(ROW_COVER_SIZE)
  const router = useRouter()
  const { view: viewParam } = useLocalSearchParams<{ view?: string }>()
  const view = parseView(viewParam)
  useEffect(() => {
    if (view === 'lyrics') countUse('lyrics')
  }, [view])
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

  const [sleepOpen, setSleepOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [devicesOpen, setDevicesOpen] = useState(false)
  // Play-and-tag, from All tags' untagged card: the tag editor up for each song in turn.
  const tagging = useTagging()
  const tagEditor = useTagEditor(tagging)
  /*
   * The lyrics have no button here (2026-10-12): the cover is the way in, by
   * a tap or a pull up, and nothing on it says so. Shown once, the first time
   * a song with words is up.
   */
  const [coverTarget, lyricsGuide] = useGuide(
    'lyrics',
    view === 'cover' && words.status === 'lyrics' && !tagging.on,
  )

  const setView = (next: PhoneView): void => {
    router.setParams({ view: next === 'lyrics' ? 'lyrics' : undefined })
  }
  const close = (): void => putAway(router)

  /*
   * The page's two views pass each other (`M2`, 1): the one arriving springs up
   * from its own side and the one leaving slides back out to its, and both are
   * there for the length of the move. Taken away in the frame the other is
   * asked for, the cover would simply stop existing and the words rise over
   * the blurred ground alone.
   *
   * Each has a value of its own rather than the two sharing one, so turning
   * round part-way is a spring retargeted from wherever the view has got to:
   * setting a value to 0 and playing it again is what made a quick up-and-down
   * jump back to the start.
   */
  const coverPresence = useViewPresence(view === 'cover', -VIEW_TRAVEL)
  const wordsPresence = useViewPresence(view === 'lyrics', VIEW_TRAVEL)

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

  /*
   * The scrubber and the transport are the page's foot, and the toasts keep
   * above them (`setPageFoot`): at the foot, a message sat over Previous, Play
   * and Next, and a failure — which stays until it is dismissed — took every
   * press meant for Next. Each view's own, since the words' transport is smaller.
   */
  const [decks, setDecks] = useState({ cover: 0, lyrics: 0 })
  const coverDeck = useCallback(
    (height: number) => setDecks(now => (now.cover === height ? now : { ...now, cover: height })),
    [],
  )
  const wordsDeck = useCallback(
    (height: number) => setDecks(now => (now.lyrics === height ? now : { ...now, lyrics: height })),
    [],
  )
  const deck = decks[view]
  useEffect(() => {
    if (deck === 0) return undefined
    const before = pageFootNow()
    setPageFoot(insets.bottom + deck)
    return () => setPageFoot(before)
  }, [deck, insets.bottom])

  // A long pull puts the page away or turns it (`swipeOutcome`). Asked only on
  // a move, so taps, the scrubber (which refuses to let go) and the scrolling
  // lyrics keep their own touches; on the words only a pull down is asked for,
  // since up is how they scroll. The page gives a little under the finger
  // rather than following it: putting it away is the page's own slide down, the
  // one the chevron plays, so the two feel alike.
  const [pull] = useState(() => new Animated.Value(0))
  // Built once. A new interpolation each render drops and rebuilds the native
  // node behind the whole page, which is everything on it.
  const [give] = useState(() =>
    pull.interpolate({
      inputRange: [-600, 0, 600],
      outputRange: [-PULL_GIVE, 0, PULL_GIVE],
      extrapolate: 'clamp',
    }),
  )
  /*
   * Opening (docs/ui-mock `M2`, 1): the page rises from the foot of the display
   * itself, on the spring, on a phone as in a browser. The navigator plays
   * nothing for this route at phone width (`shell/pageStep.ts`) so that it can:
   * the page's rise and the cover travelling up inside it are one move on one
   * value, and a navigator sliding the page under them could not be told where
   * the mini player's cover had been. An iPad is the stage, not this page, and
   * there the stack's own slide is the move.
   */
  const window = useWindowDimensions()
  const arrival = useEntrance()
  const lift = useMemo(
    () =>
      Animated.add(
        give,
        arrival.interpolate({ inputRange: [0, 1], outputRange: [window.height, 0] }),
      ),
    [give, arrival, window.height],
  )
  /*
   * And closing. Whatever puts the page away — the chevron, a pull, the song's
   * own page, the bar — goes through `leaveStage`, which plays this and then
   * changes the route (`shell/stageExit.ts`).
   *
   * Running the arrival back to 0 is the rise in reverse: the page's place is a
   * straight line in it, so the page carries on down from exactly where it is,
   * a pull half way to the foot included, and the cover travels back down to
   * the mini player's with it. Shorter than the arrival and on `ease.in`, as
   * every exit is.
   *
   * Its own `Animated.timing` rather than `timing`, for the reason the stage's
   * exit has one: what happens at the end is a route change, and that must not
   * happen for an exit that was stopped part-way. `motionMs` is how it answers
   * Reduce Motion instead, and at no length at all the page is simply gone.
   */
  useEffect(() => {
    setStageExit(done => {
      Animated.timing(arrival, {
        toValue: 0,
        duration: motionMs(MOVE_MS.sheetDown),
        easing: ease.in,
        useNativeDriver: nativeDriver,
      }).start(({ finished }) => done(finished))
    }, modalCoversScreen)
    return () => setStageExit(null)
  }, [arrival])
  /*
   * Whether the finger now down came down on the words. Dragging down there
   * is reading back up the song, not a pull: the list is kept on the sung
   * line, so it is almost never at its top, and the page took any drag down
   * of 12 points before the list's own scroll had begun — a flick back
   * through the verse flipped the page to the cover (Xiao, 2026-10-07). The
   * head strip above the words still pulls, and the chevron still goes back.
   */
  const [fingerOnWords] = useState(() => new TouchFlag())
  const pan = useMemo(() => {
    const settle = (): void => void spring(pull, 0)
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) =>
        isVerticalPull(gesture.dx, gesture.dy) &&
        (view === 'cover' || (gesture.dy > 0 && !fingerOnWords.on())),
      onPanResponderMove: (_event, gesture) =>
        pull.setValue(view === 'cover' ? gesture.dy : Math.max(0, gesture.dy)),
      onPanResponderRelease: (_event, gesture) => {
        const outcome = swipeOutcome({
          view,
          dy: gesture.dy,
          vy: gesture.vy,
          close: PULL.close,
          flick: PULL.flick,
        })
        // Let go far enough down: the pull is left where the finger left it and
        // the page goes on from there to the foot. Springing back to nothing
        // and navigating in the same tick would bounce the page up as the
        // route changed under it.
        if (outcome === 'close') {
          putAway(router)
          return
        }
        settle()
        if (outcome === 'lyrics') router.setParams({ view: 'lyrics' })
        else if (outcome === 'cover') router.setParams({ view: undefined })
      },
      onPanResponderTerminate: settle,
    })
  }, [pull, router, view, fingerOnWords])

  // Where the mini player's cover was a moment before it pushed this route
  // (`ui/coverHandoff.ts`). Taken once, and here rather than in the cover view:
  // a page opened straight onto the words would otherwise have taken it stale,
  // whole songs later. It is read against the page's arrival, so a cover that
  // turns up after the page has risen is simply at rest.
  const [handed] = useState(takeCoverHandoff)

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
            {
              backgroundColor: withAlpha(
                theme.colors.surface0,
                backdropVeil(song.coverTone, scheme, view === 'lyrics' ? 0.7 : 0.56),
              ),
            },
          ]}
        />
      </View>
      {/* Both views for the length of the move, one over the other, and only
          the one being shown takes touches. */}
      {coverPresence.mounted ? (
        <Animated.View
          pointerEvents={view === 'cover' ? 'auto' : 'none'}
          style={[styles.screen, styles.viewLayer, edges, coverPresence.style]}
        >
          <CoverView
            song={song}
            uri={uri}
            color={songColor.color}
            tagging={tagging.on ? { line: tagging.line, stop: tagging.stop } : null}
            onClose={close}
            onLyrics={() => setView('lyrics')}
            onTags={tagEditor.toggle}
            onSleep={() => setSleepOpen(true)}
            onMore={() => setMoreOpen(true)}
            opening={arrival}
            handed={handed}
            guide={lyricsGuide}
            guideTarget={coverTarget}
            onDeck={coverDeck}
          />
        </Animated.View>
      ) : null}
      {wordsPresence.mounted ? (
        <Animated.View
          pointerEvents={view === 'lyrics' ? 'auto' : 'none'}
          style={[styles.screen, styles.viewLayer, edges, wordsPresence.style]}
        >
          <WordsView
            song={song}
            uri={uri}
            lyrics={lyrics}
            noLyrics={noLyrics}
            onBack={() => setView('cover')}
            fingerOnWords={fingerOnWords}
            onDeck={wordsDeck}
          />
        </Animated.View>
      ) : null}

      {/* The song menu every other screen has, less what the page shows itself,
          with the sleep timer and Devices after it: this page has no other door
          to them, nor to Song details. Removing asks above the page, and a link
          (the song's own page included) puts the page away first, so back from
          it lands where Now Playing was opened. */}
      <SongMenu
        song={moreOpen ? song : null}
        onClose={() => setMoreOpen(false)}
        context="nowPlaying"
        extras={{ onSleep: () => setSleepOpen(true), onDevices: () => setDevicesOpen(true) }}
        onRemove={onRemove}
        onOpen={href => leaveTo(router, href)}
      />
      <SleepMenu open={sleepOpen} onClose={() => setSleepOpen(false)} />
      <DevicesSheet open={devicesOpen} onClose={() => setDevicesOpen(false)} />
      {/*
        A sheet from the foot of the page, as the picker is on a phone: the
        cover and the head, with the tagging line in it, stay in sight above it.
      */}
      <TagPicker song={tagEditor.shown ? song : null} onClose={tagEditor.close} />
      <Guide
        inline
        guide={lyricsGuide}
        at={{ x: 0.5, y: 0.72 }}
        radius={18}
        steps={LYRICS_GUIDE_STEPS}
      />
    </Animated.View>
  )
}

/** How far the page gives under a pull, however far the finger goes on. */
const PULL_GIVE = 150

/** The cover view (`P21`). */
function CoverView({
  song,
  uri,
  color,
  tagging,
  onClose,
  onLyrics,
  onTags,
  onSleep,
  onMore,
  opening,
  handed,
  guide,
  guideTarget,
  onDeck,
}: {
  song: Song
  uri: string | null | undefined
  color: string
  /** How tall the scrubber and the transport are together, so the toasts keep above them. */
  onDeck: (height: number) => void
  /** The lyrics guide, which lights the cover and lifts it a little as the hand pulls. */
  guide: GuideHandle
  guideTarget: GuideTarget
  /** The page opening, 0 to 1; already 1 by the time the words have been and gone. */
  opening: Animated.Value
  /** Where the mini player's cover was, for the page's cover to start from. */
  handed: CoverFrame | null
  tagging: { line: string; stop: () => void } | null
  onClose: () => void
  onLyrics: () => void
  onTags: () => void
  onSleep: () => void
  onMore: () => void
}): ReactNode {
  const { theme } = useUnistyles()
  const router = useRouter()
  // While a timer runs the header says how long is left, and is the way to change it.
  const sleep = useSleepTimerStatus()
  // A room shows itself in the head's middle, unless tagging or the sleep
  // timer has it; then its faces stand in for Together on the right.
  const inRoom = useRoom().state !== null
  const middleTaken = tagging !== null || sleep.line !== null

  return (
    <>
      <View style={styles.head}>
        <View style={styles.headSide}>
          <IconButton onPress={onClose} label="Close now playing" filled>
            <ChevronDown size={iconSize.large} color={theme.colors.textPrimary} />
          </IconButton>
        </View>
        {/* Play-and-tag takes the head's line: at the top, it stays clear of the editor's sheet. */}
        {tagging ? (
          <TaggingLine line={tagging.line} onStop={tagging.stop} center />
        ) : sleep.line !== null ? (
          <View style={styles.headMiddle}>
            <HeadPill
              lead={<Moon size={iconSize.field} color={theme.colors.accent} />}
              text={sleep.line}
              label={`Sleep timer: ${sleep.line}`}
              onPress={onSleep}
              testID="now-playing-sleep"
            />
          </View>
        ) : inRoom ? (
          <View style={styles.headMiddle}>
            <RoomPill />
          </View>
        ) : (
          <PlayingFrom />
        )}
        {/* Both sides as wide, so whatever is in the middle sits in the middle. */}
        <View style={[styles.headSide, styles.headSideEnd]}>
          {inRoom && !middleTaken ? null : <TogetherButton filled />}
          <IconButton onPress={openQueueSheet} label="Up next" filled testID="now-playing-queue">
            <UpNext size={iconSize.nav} color={theme.colors.textPrimary} />
          </IconButton>
        </View>
      </View>

      <BreathingCover
        song={song}
        uri={uri}
        onPress={onLyrics}
        opening={opening}
        handed={handed}
        guide={guide}
        guideTarget={guideTarget}
      />

      <View style={styles.titleRow}>
        <View style={styles.titles}>
          {/* The one thing read on this page: its own line, and two if it needs them. */}
          <Text style={styles.title} numberOfLines={2}>
            {song.title}
          </Text>
          <Text style={styles.artist} numberOfLines={1}>
            <ArtistLinks artist={song.artist} onOpen={href => leaveTo(router, href)} />
          </Text>
        </View>
        <View style={styles.titleButtons}>
          <LikeButton song={song} filled />
          <IconButton onPress={onMore} label="More" filled testID="now-playing-more">
            <More size={iconSize.nav} color={theme.colors.textPrimary} />
          </IconButton>
        </View>
      </View>

      <SongTagsLine
        song={song}
        // A page of the app, so the modal goes down first, as the song's own
        // page does (`openSong`): pushed from inside it, the tag's page landed
        // under the modal, out of sight.
        onOpen={href => leaveTo(router, href)}
        onEdit={onTags}
        labelled
        style={styles.tags}
      />

      <View onLayout={event => onDeck(event.nativeEvent.layout.height)}>
        <View style={styles.progress}>
          <SeekBar color={color} />
        </View>

        {/* The round white Play (`S2`) is the page's one primary. */}
        <TransportControls size="page" tint={color} style={styles.controls} />
      </View>
    </>
  )
}

/**
 * The head's middle, where an eyebrow said "Now playing" on the one page that
 * can only be that: where the music came from instead, as Up next names it
 * ("From Library", "From night", "From Long walks"), and a press opens it.
 * Nothing at all when Up next has no name for its songs, as when a row of
 * Library is played on its own.
 */
function PlayingFrom(): ReactNode {
  const router = useRouter()
  const { source, queue } = usePlayer()
  const { data: library } = useLibrary()
  const line = useMemo(
    () =>
      source && library && queue.items.length > 0
        ? describeSource(source, { tags: library.tags, playlists: library.playlists })
        : null,
    [source, library, queue.items.length],
  )
  if (!line) return <View style={styles.from} />
  const link = line.link
  return (
    <Press
      feedback="dim"
      onPress={link ? () => leaveTo(router, link as Href) : undefined}
      disabled={!link}
      accessibilityRole={link ? 'link' : 'text'}
      accessibilityLabel={link ? `Open ${line.label}` : `Playing from ${line.label}`}
      style={styles.from}
    >
      <Text style={styles.fromLabel} numberOfLines={1} testID="now-playing-from">
        From {line.label}
      </Text>
    </Press>
  )
}

/** How small the cover starts as the page opens with nowhere to have come from. */
const COVER_OPENS_AT = 0.6

/** The room the cover is centred in, where the page laid it out. */
interface CoverRoom {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

type CoverTransform = (
  | { translateX: Animated.AnimatedInterpolation<number> }
  | { translateY: Animated.AnimatedInterpolation<number> }
  | { scale: Animated.AnimatedMultiplication<number> }
)[]

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
  handed,
  guide,
  guideTarget,
}: {
  song: Song
  uri: string | null | undefined
  onPress: () => void
  opening: Animated.Value
  handed: CoverFrame | null
  guide: GuideHandle
  guideTarget: GuideTarget
}): ReactNode {
  const playing = usePlayerPlaying()
  // A swipe across the cover lets go as a press; only a tap opens the words.
  const touch = useTouchTravel()
  // The app's own width, not the window's (`shell/rootWidth.ts`).
  const { width } = useLayout()
  const window = useWindowDimensions()
  const [room, setRoom] = useState<CoverRoom | null>(null)
  // Inside the room's own padding, and never more than the room: measured, the
  // room includes `art`'s padding, so a cover sized to all of it touched the
  // head and the title, and a 120 floor in a short window ran over both.
  const size = Math.max(
    0,
    Math.floor(
      room
        ? Math.min(room.width, room.height - ART_PADDING * 2, COVER_MOST)
        : Math.min(width - space.lg * 2, 342),
    ),
  )

  const [breath] = useState(() => new Animated.Value(playing ? 1 : PAUSED_COVER_SCALE))
  useEffect(() => {
    // A pause is a settling and a play is a lift, so the two are not the same
    // move backwards: it shrinks on a curve and grows back on the spring, which
    // gives the cover the small living overshoot on play that a timed curve of
    // the same length both ways cannot.
    if (playing) spring(breath, 1)
    else timing(breath, PAUSED_COVER_SCALE, MOVE_MS.breath, undefined, { easing: ease.out })
  }, [playing, breath])

  /*
   * The cover's travel from the mini player's (`M2`, 1), as two numbers and a
   * ratio: the nearest this app comes to the board's shared element, and it
   * needs no library, only where the other cover was.
   *
   * A scale holds a view's centre still, so the travel is centre to centre. The
   * page is rising at the same time and on the same value, and that rise has to
   * come out of these numbers: at the start the page sits a whole window height
   * below where it will rest, so the cover is carried that much further up again
   * to be left over the mini player's. Both are straight lines in the value —
   * the only shape the native driver can run — and their sum is the line the
   * cover is seen to take. At the end both are nothing, which is the cover's own
   * place, so a cover that turns up after the page has risen (the words were
   * showing when it opened) simply rests there.
   *
   * The room is measured against the page and the handed frame against the
   * window, and the two are taken to be the same: this page covers the display
   * from its top left corner, and in a browser at phone width the shell's
   * content area starts there too.
   */
  const travel = useMemo(() => {
    if (handed === null || room === null) return null
    return {
      x: handed.x + handed.size / 2 - (room.x + room.width / 2),
      y: handed.y + handed.size / 2 - (room.y + room.height / 2) - window.height,
      scale: handed.size / size,
    }
  }, [handed, room, size, window.height])

  const transform = useMemo((): CoverTransform => {
    const between = (a: number, b: number): Animated.AnimatedInterpolation<number> =>
      opening.interpolate({ inputRange: [0, 1], outputRange: [a, b] })
    // With nowhere to have come from — a lock-screen tap, an address — the cover
    // grows into place where it is. The breath multiplies into the same scale
    // either way, so a play or a pause while the page is opening compounds with
    // it rather than fighting it.
    if (travel === null) return [{ scale: Animated.multiply(breath, between(COVER_OPENS_AT, 1)) }]
    return [
      { translateX: between(travel.x, 0) },
      { translateY: between(travel.y, 0) },
      { scale: Animated.multiply(breath, between(travel.scale, 1)) },
    ]
  }, [breath, opening, travel])

  return (
    <View
      style={styles.art}
      onLayout={event => {
        const { x, y, width: w, height: h } = event.nativeEvent.layout
        setRoom(current =>
          current?.x === x && current.y === y && current.width === w && current.height === h
            ? current
            : { x, y, width: w, height: h },
        )
      }}
    >
      {/* What the lyrics guide lights: the cover, not the room around it, and
          where it rests rather than where the guide's pull has lifted it. */}
      <View ref={guideTarget} collapsable={false}>
        <Animated.View style={guide.shown ? riseWith(guide, 24) : null} {...touch.handlers}>
          <Animated.View style={[styles.artShadow, { transform }]}>
            <Press
              depth="row"
              onPress={() => {
                if (!touch.moved()) onPress()
              }}
              accessibilityRole="button"
              accessibilityLabel="Show the lyrics"
            >
              <Cover uri={uri} title={song.album || song.title} size={size} />
            </Press>
          </Animated.View>
        </Animated.View>
      </View>
    </View>
  )
}

/**
 * The words alone (`P22`): a small header with the way back, the song and the
 * romaji or pinyin switch; the lyrics across the page; and the scrubber and
 * the transport under them. A song with no lyrics says so where the words
 * would be — no visual on a phone (Xiao, 2026-10-09) — and the switch's place
 * asks the lookup for lyrics again, as the computer's does.
 */
function WordsView({
  song,
  uri,
  lyrics,
  noLyrics,
  onBack,
  fingerOnWords,
  onDeck,
}: {
  song: Song
  uri: string | null | undefined
  /** How tall the scrubber and the transport are together, so the toasts keep above them. */
  onDeck: (height: number) => void
  lyrics: ReturnType<typeof useSongWords>
  noLyrics: boolean
  onBack: () => void
  /** Set while a finger that came down on the words is still down: the page's pull leaves it to the list. */
  fingerOnWords: TouchFlag
}): ReactNode {
  const { theme } = useUnistyles()
  // A line held: Share from here, Play from here, Copy line.
  const lineMenu = useLineMenu(song, lyrics.words)

  return (
    <View style={styles.wordsView} testID="now-playing-lyrics-view">
      <PhoneWordsHead
        title={song.title}
        artist={artistOr(song.artist)}
        cover={uri}
        coverTitle={song.album || song.title}
        onBack={onBack}
        tool={
          canRomanize(lyrics) ? (
            <RomanizeButton lyrics={lyrics} />
          ) : noLyrics ? (
            <FindLyricsButton onPress={lyrics.lookAgain} />
          ) : null
        }
      />
      <PhoneWordsBody
        words={lyrics.words}
        fingerOnWords={fingerOnWords}
        onLineMenu={lineMenu.onLineMenu}
        style={styles.words}
      />
      {lineMenu.menu}

      <View onLayout={event => onDeck(event.nativeEvent.layout.height)}>
        <View style={styles.progress}>
          <SeekBar color={theme.colors.textPrimary} />
        </View>
        <TransportControls
          size="words"
          tint={theme.colors.textPrimary}
          style={styles.wordsControls}
        />
      </View>
    </View>
  )
}

/** The space kept above and below the cover in its room. */
const ART_PADDING = space.lg

/**
 * The cover's largest, centred in its room: a browser just under the computer
 * width (744–819) gets this page, where the cover filled 674 of 819 (P7 A).
 * A phone never reaches it.
 */
const COVER_MOST = 520

const styles = StyleSheet.create(theme => ({
  shell: { flex: 1 },
  screen: { flex: 1 },
  // The page's two views are laid one over the other while they pass, so neither
  // takes its place in a column with the other.
  viewLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
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
  from: { flex: 1, minWidth: 0, alignItems: 'center' },
  fromLabel: { color: theme.colors.textSecondary, fontSize: type.sub, textAlign: 'center' },
  art: {
    flex: 1,
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: ART_PADDING,
  },
  artShadow: { borderRadius: radius.card, ...artShadow(theme.colors) },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
  },
  titles: { flex: 1, minWidth: 0, gap: 3 },
  titleButtons: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  headMiddle: { flex: 1, alignItems: 'center' },
  // Two of the head's round buttons and the gap between them.
  headSide: { width: 40 * 2 + space.sm, flexDirection: 'row', gap: space.sm },
  headSideEnd: { justifyContent: 'flex-end' },
  // The song's name is the display face, which carries its own weight.
  title: heroTitle(theme.colors, 'large'),
  artist: {
    color: theme.colors.textSecondary,
    fontSize: type.body,
  },
  tags: { marginTop: space.md },
  progress: {
    marginTop: space.lg,
    marginBottom: space.tight,
  },
  // The page's last line: room under it for the home indicator's swipe.
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xs,
    paddingBottom: space.xl,
  },
  wordsView: { flex: 1, minHeight: 0 },
  words: {
    marginTop: space.md,
    marginHorizontal: -space.lg,
    paddingHorizontal: space.lg - 6,
  },
  // The shell's toast row, at the foot of the page, which has no chrome to sit above.
  toasts: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
  },
  wordsControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 26,
    paddingBottom: space.sm,
  },
}))
