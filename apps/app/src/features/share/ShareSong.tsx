import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, PanResponder, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import {
  artistOr,
  formatShareStart,
  type RoomSong,
  type ShareLine,
  type Song,
} from '@selfmp3/shared'
import { radius, space, type } from '@selfmp3/client'
import { fonts } from '../../ports/fonts'
import { Guide } from '../guide/Guide'
import { useGuide } from '../guide/useGuide'
import { canRomanize, RomanizeButton } from '../nowPlaying/LyricsTools'
import {
  isVerticalPull,
  stageGeometry,
  swipeOutcome,
  TOOLS_CLEARANCE,
} from '../nowPlaying/nowPlaying.model'
import { LYRICS_GUIDE_STEPS, PhoneWordsBody, PhoneWordsHead } from '../nowPlaying/PhoneWords'
import { SongVisual } from '../nowPlaying/SongVisual'
import { StageLyrics } from '../nowPlaying/StageLyrics'
import { lyricsStatusText } from '../nowPlaying/stageLyrics.model'
import { useMotionSampler } from '../nowPlaying/useMotionSampler'
import { useViewPresence, VIEW_TRAVEL } from '../nowPlaying/useViewPresence'
import type { SongLyrics } from '../nowPlaying/useSongWords'
import { useBottomInset } from '../../shell/bottomInset'
import { useLayout, useWindowValue } from '../../shell/useLayout'
import { PULL } from '../../ui/motion.model'
import { artShadow, heroTitle } from '../../ui/surfaces'
import { Cover } from '../../ui/components/Cover'
import { IconButton } from '../../ui/components/IconButton'
import { Next, Prev, Shuffle } from '../../ui/components/Icons'
import { PlayPauseButton } from '../../ui/components/PlayPauseButton'
import { Press } from '../../ui/components/Press'
import { SeekBar } from '../../ui/components/SeekBar'
import { TouchFlag } from '../../ui/touchFlag'

/**
 * What the stage keeps under its title besides Now Playing's own: the link's
 * bar and Play, which on Now Playing are the player bar's.
 */
const TRANSPORT_ROOM = 120

/** The stage's head: its height, as Now Playing's head is. */
const STAGE_HEAD = 60
/** From the head to the cover, as Now Playing's `COVER_TOP` is past its head. */
const STAGE_COVER_GAP = 24

/** How far a lyric line's words sit inside its press wash (`StageLyrics`). */
const LINE_INSET = space.tight

/** Everything on the phone's cover view but the cover, for the cover to fit the screen beside. */
const PHONE_ROOM = 320
const PHONE_COVER_LEAST = 160
const PHONE_COVER_MOST = 420
/** What the line a link was shared from takes under the names, for the cover to give up. */
const PHONE_LINE_ROOM = 112
/** What a list's name and row of covers take over the song, for the cover to give up. */
const PHONE_LIST_ROOM = 96
/** What the line saying where the song is in its list takes over the title. */
const CONTEXT_ROOM = 24

/**
 * A list link's song (R1, P1): where it is in the list, and the steps
 * through it. Next and Previous stay among the list's songs.
 */
interface ShareSongList {
  /** "jpop · 7 of 100", over the title. */
  context: string
  onPrevious: () => void
  onNext: () => void
  onShuffle: () => void
  /** The list's name and its row of covers, over the song on a phone. */
  covers: ReactNode
}

interface SongProps {
  song: RoomSong
  /** The same song as the player has it, for its visual. */
  track: Song
  /** The player's id for it. */
  songId: number
  cover: string | null
  /** The letter tile's hue, the page's own colour's, for a cover that would not come. */
  tileHue: number
  lyrics: SongLyrics
  /** The link lends words for it, so there are words to turn to. */
  lent: boolean
  /** It is the song the player has. */
  loaded: boolean
  /** Where it starts, and the line, when it was shared from one (`?t=0:42`). */
  start: { at: number; line: ShareLine | null } | null
  onPlay: () => void
  /** The way back to Home, in the app. */
  back: ReactNode
  /** Who sent it, and how long it has. */
  from: ReactNode
  /** Get it, signed in. */
  ways: ReactNode
  /** What self.mp3 is, signed out. */
  foot: ReactNode
  /** The phone's words over its cover. */
  wordsOpen: boolean
  onWords: (open: boolean) => void
  /** A list link's: the song is one of its songs. */
  list?: ShareSongList
}

/**
 * A one-song link that still plays (docs/features/share-links.md): Now
 * Playing's own two layouts, drawn from what the link lends. On a computer
 * the stage, cover and names on the left and the words beside them in time;
 * on a phone the phone's page, the cover with Play low under it and the
 * words a view of their own, opened the way Now Playing's are.
 */
export function ShareSong(props: SongProps): ReactNode {
  return useShareStage() ? <SongStage {...props} /> : <SongPhone {...props} />
}

/**
 * Whether a link's song is laid out as the stage: a computer's width, not a
 * page taller than it is wide (an iPad in portrait), which is a phone's.
 */
export function useShareStage(): boolean {
  const { wide, width } = useLayout()
  const height = useWindowValue(window => window.height)
  return wide && !stageGeometry(width, height).stacked
}

/**
 * The bar, held at the start and still until the song is loaded, so nothing
 * moves when it plays.
 */
function Seek({ song, loaded }: { song: RoomSong; loaded: boolean }): ReactNode {
  const { theme } = useUnistyles()
  return (
    <View pointerEvents={loaded ? 'auto' : 'none'}>
      <SeekBar color={theme.colors.textPrimary} waiting={loaded ? undefined : song.duration} />
    </View>
  )
}

function Play({ song, songId, onPlay, size }: SongProps & { size?: number }): ReactNode {
  return (
    <PlayPauseButton
      songId={songId}
      size={size}
      playLabel={`Play ${song.title}`}
      onPress={onPlay}
      testID="share-play"
    />
  )
}

/**
 * A list's steps either side of Play: Previous and Next, and on a phone
 * Shuffle too, where the rail that holds it on a computer is not.
 */
function Steps(props: SongProps & { list: ShareSongList; phone: boolean }): ReactNode {
  const { list, phone } = props
  const { theme } = useUnistyles()
  const step = phone ? 30 : 24
  return (
    <View style={[styles.steps, phone && styles.phoneSteps]}>
      {phone ? (
        <IconButton onPress={list.onShuffle} label="Shuffle" testID="share-shuffle">
          <Shuffle size={20} color={theme.colors.textSecondary} />
        </IconButton>
      ) : null}
      <IconButton
        onPress={list.onPrevious}
        label="Previous"
        size={phone ? 52 : undefined}
        testID="share-previous"
      >
        <Prev size={step} color={theme.colors.textPrimary} />
      </IconButton>
      <Play {...props} size={phone ? 64 : undefined} />
      <IconButton
        onPress={list.onNext}
        label="Next"
        size={phone ? 52 : undefined}
        testID="share-next"
      >
        <Next size={step} color={theme.colors.textPrimary} />
      </IconButton>
      {/* Shuffle's width again on the other side, so Play sits in the middle. */}
      {phone ? <View style={styles.stepsBalance} /> : null}
    </View>
  )
}

function bylineOf(song: RoomSong): string {
  return [artistOr(song.artist), song.album].filter(Boolean).join(' · ')
}

/**
 * The computer's: Now Playing's stage (`stageGeometry`), its cover at the top
 * of the left column with the title under it, then the link's bar and Play.
 * The words take the column to the right, read as the page opens so it is
 * whole before Play, and held still until the song plays, then in time. A song without words has its visual there instead, as Now
 * Playing's does (`C10`), so the page is laid out the same either way.
 */
function SongStage(props: SongProps): ReactNode {
  const { song, track, cover, tileHue, lyrics, lent, loaded, start, back, from, ways, foot } = props
  const { list } = props
  const { theme } = useUnistyles()
  const layout = useLayout()
  const windowHeight = useWindowValue(window => window.height)
  // Its own size once laid out: signed in, the sidebar and the bar take some of the window.
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const geometry = stageGeometry(
    size?.width ?? layout.width,
    (size?.height ?? windowHeight) - TRANSPORT_ROOM - (list ? CONTEXT_ROOM : 0),
  )
  const words = lyrics.words
  const sides = { paddingLeft: geometry.pad, paddingRight: geometry.right }
  // Lent without words, or with words that would not read.
  const showVisual = !lent || words.status === 'missing'
  const sampler = useMotionSampler(track, showVisual)
  // Until it plays, the line it was shared from has the words' column; then
  // the words in time, which start on that line.
  const shared = !loaded && start?.line ? { at: start.at, line: start.line } : null

  return (
    <View
      style={styles.stage}
      onLayout={event => {
        const { width, height } = event.nativeEvent.layout
        setSize(now => (now?.width === width && now.height === height ? now : { width, height }))
      }}
      testID="share-stage"
    >
      {/* Darker toward the words, as the stage is, so they sit on something calm. */}
      <View pointerEvents="none" style={styles.fill}>
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id="share-shade" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={theme.colors.surface0} stopOpacity={0} />
              <Stop offset="0.55" stopColor={theme.colors.surface0} stopOpacity={0.45} />
              <Stop offset="1" stopColor={theme.colors.surface0} stopOpacity={0.45} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#share-shade)" />
        </Svg>
      </View>

      <View style={[styles.stageHead, sides]}>
        {back}
        {from}
      </View>

      <View style={[styles.stageBody, sides, { gap: geometry.gutter }]}>
        <View style={[styles.side, { width: geometry.column }]}>
          <View style={styles.art}>
            <Cover uri={cover} title={song.title} size={geometry.cover} hue={tileHue} />
          </View>
          <View style={styles.stageNames}>
            {list ? (
              <Text style={styles.context} numberOfLines={1} testID="share-context">
                {list.context}
              </Text>
            ) : null}
            <Text
              style={[
                styles.stageTitle,
                {
                  fontSize: geometry.title,
                  lineHeight: geometry.title * 1.15,
                  letterSpacing: -0.02 * geometry.title,
                },
              ]}
              accessibilityRole="header"
              numberOfLines={2}
            >
              {song.title}
            </Text>
            <Text style={styles.stageByline} numberOfLines={2}>
              {bylineOf(song)}
            </Text>
          </View>
          <Seek song={song} loaded={loaded} />
          <View style={styles.stageTransport}>
            {list ? <Steps {...props} list={list} phone={false} /> : <Play {...props} />}
            <View style={styles.stageWays}>{ways}</View>
          </View>
          <View style={styles.stageFoot}>{foot}</View>
        </View>

        {shared ? (
          <View style={styles.stageLine}>
            <SharedLine at={shared.at} line={shared.line} size={geometry.lyric * 1.35} />
          </View>
        ) : showVisual ? (
          <View style={styles.stageVisual} testID="share-visual">
            <SongVisual song={track} sampler={sampler} cover={cover} />
          </View>
        ) : (
          <View style={styles.stageWords} testID="share-words">
            {words.status === 'lyrics' ? (
              <StageLyrics
                parsed={words.parsed}
                roman={words.roman}
                focus={false}
                fontSize={geometry.lyric}
                clearRight={canRomanize(lyrics) ? TOOLS_CLEARANCE : 0}
                still={!loaded}
              />
            ) : (
              <View style={styles.status}>
                <Text style={styles.statusText}>{lyricsStatusText(words)}</Text>
              </View>
            )}
            {canRomanize(lyrics) ? (
              <View style={styles.tools}>
                <RomanizeButton lyrics={lyrics} />
              </View>
            ) : null}
          </View>
        )}
      </View>
    </View>
  )
}

/**
 * The phone's: Now Playing's page on a phone. The cover across the page, the
 * title, the bar, and Play low where a thumb is; Get it under it. The words
 * are the page's other view, opened as Now Playing's are, by a tap on the
 * cover or a pull up, and put back by a pull down or the chevron. Nothing on
 * the cover says so but the guide Now Playing shows, once.
 *
 * The bar, Play and what is under them are drawn once, below both views, so
 * only the cover and the words pass each other and the controls never move.
 */
function SongPhone(props: SongProps): ReactNode {
  const { song, cover, tileHue, lyrics, lent, loaded, start, back, from, ways, foot } = props
  const { wordsOpen, onWords, list } = props
  const line = start?.line ?? null
  const { width } = useLayout()
  const height = useWindowValue(window => window.height)
  const insets = useSafeAreaInsets()
  // Whatever of the app floats over the page's foot: nothing while the link's
  // page owns the display, as it does now (`pageChrome.ts`).
  const chrome = useBottomInset()
  const words = lyrics.words
  // The page's one column: the head, the names, the bar and the words.
  const column = Math.min(width - space.gutter * 2, PHONE_COVER_MOST)
  // The cover as big as the column, short of pushing Play off a short screen,
  // where it is smaller and in the column's middle, as Now Playing's is.
  const side = Math.max(
    PHONE_COVER_LEAST,
    Math.min(
      column,
      height -
        insets.top -
        insets.bottom -
        PHONE_ROOM -
        chrome -
        (line ? PHONE_LINE_ROOM : 0) -
        (list ? PHONE_LIST_ROOM : 0),
    ),
  )

  // Now Playing's own move between them: the one arriving springs in as the other goes.
  const coverView = useViewPresence(!wordsOpen, -VIEW_TRAVEL)
  const wordsView = useViewPresence(wordsOpen, VIEW_TRAVEL)

  // A pull up on the cover opens the words; a pull down goes back, except on
  // the words themselves, where dragging down is reading back up the song.
  const [fingerOnWords] = useState(() => new TouchFlag())
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          lent &&
          isVerticalPull(gesture.dx, gesture.dy) &&
          (wordsOpen ? gesture.dy > 0 && !fingerOnWords.on() : gesture.dy < 0),
        onPanResponderRelease: (_event, gesture) => {
          const outcome = swipeOutcome({
            view: wordsOpen ? 'lyrics' : 'cover',
            dy: gesture.dy,
            vy: gesture.vy,
            close: PULL.close,
            flick: PULL.flick,
          })
          if (outcome === 'lyrics') onWords(true)
          else if (outcome === 'cover') onWords(false)
        },
      }),
    [lent, wordsOpen, onWords, fingerOnWords],
  )

  // Now Playing's guide, the same one: seen there, it is not shown here again.
  const [coverTarget, guide] = useGuide(
    'lyrics',
    lent && !wordsOpen && loaded && words.status === 'lyrics',
  )

  return (
    <View style={[styles.phone, chrome > 0 && { paddingBottom: chrome }]} {...pan.panHandlers}>
      <View style={styles.phoneViews}>
        {coverView.mounted ? (
          <Animated.View
            pointerEvents={wordsOpen ? 'none' : 'auto'}
            aria-hidden={wordsOpen}
            style={[styles.layer, styles.phonePage, coverView.style]}
          >
            {back}
            <View style={[styles.phoneColumn, { width: column }]}>
              {from}
              {list?.covers}
              <View ref={coverTarget} collapsable={false} style={[styles.art, styles.phoneArt]}>
                <Press
                  disabled={!lent}
                  onPress={() => onWords(true)}
                  accessibilityLabel={lent ? 'Show the lyrics' : undefined}
                >
                  <Cover uri={cover} title={song.title} size={side} hue={tileHue} />
                </Press>
              </View>
              <View style={styles.phoneNames}>
                {list ? (
                  <Text style={styles.context} numberOfLines={1} testID="share-context">
                    {list.context}
                  </Text>
                ) : null}
                <Text style={styles.phoneTitle} accessibilityRole="header" numberOfLines={2}>
                  {song.title}
                </Text>
                <Text style={styles.phoneByline} numberOfLines={2}>
                  {bylineOf(song)}
                </Text>
              </View>
              {start && line ? <SharedLine at={start.at} line={line} size={24} /> : null}
            </View>
          </Animated.View>
        ) : null}

        {wordsView.mounted ? (
          <Animated.View
            pointerEvents={wordsOpen ? 'auto' : 'none'}
            aria-hidden={!wordsOpen}
            style={[styles.layer, styles.phonePage, styles.wordsPage, wordsView.style]}
            testID="share-words"
          >
            <PhoneWordsHead
              title={song.title}
              artist={artistOr(song.artist)}
              cover={cover}
              coverTitle={song.title}
              onBack={() => onWords(false)}
              tool={canRomanize(lyrics) ? <RomanizeButton lyrics={lyrics} /> : null}
              style={[styles.wordsHead, { width: column }]}
            />
            <PhoneWordsBody
              words={words}
              fingerOnWords={fingerOnWords}
              still={!loaded}
              // The lines' own inset past the bar's ends, so their words start and end where it does.
              style={[styles.words, { width: column + LINE_INSET * 2 }]}
            />
          </Animated.View>
        ) : null}
      </View>

      <View style={[styles.phoneControls, { width: column }]}>
        <Seek song={song} loaded={loaded} />
        {list ? (
          <Steps {...props} list={list} phone />
        ) : (
          <View style={styles.phonePlay}>
            <Play {...props} size={64} />
          </View>
        )}
        {ways}
      </View>
      <View style={styles.phoneFoot}>{foot}</View>

      <Guide guide={guide} at={{ x: 0.5, y: 0.72 }} radius={18} steps={LYRICS_GUIDE_STEPS} />
    </View>
  )
}

/**
 * The line a link was shared from, large: where it starts, the line, and its
 * romaji or pinyin under it when its sender had that on, drawn as a lyric
 * line and its reading are (`StageLyrics`).
 */
function SharedLine({ at, line, size }: { at: number; line: ShareLine; size: number }): ReactNode {
  return (
    <View style={styles.shared} testID="share-line">
      <Text style={styles.sharedAt}>From {formatShareStart(at)}</Text>
      <Text
        style={[
          styles.sharedText,
          { fontSize: size, lineHeight: size * 1.3, letterSpacing: -0.01 * size },
        ]}
        numberOfLines={4}
      >
        {line.text}
      </Text>
      {line.reading ? (
        <Text
          style={[styles.sharedReading, { fontSize: size * 0.7, lineHeight: size * 0.7 * 1.3 }]}
          numberOfLines={3}
        >
          {line.reading}
        </Text>
      ) : null}
    </View>
  )
}

/** An ended one-song link's head: its cover, faded, and its names. */
export function SongStill({
  song,
  cover,
  tileHue,
  size,
}: {
  song: RoomSong
  cover: string | null
  tileHue: number
  size: number
}): ReactNode {
  return (
    <View style={styles.still}>
      <View style={[styles.art, styles.faded]}>
        <Cover uri={cover} title={song.title} size={size} hue={tileHue} />
      </View>
      <View style={styles.phoneNames}>
        <Text style={styles.phoneTitle} accessibilityRole="header" numberOfLines={3}>
          {song.title}
        </Text>
        <Text style={styles.phoneByline} numberOfLines={2}>
          {bylineOf(song)}
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  art: { alignSelf: 'flex-start', borderRadius: radius.card, ...artShadow(theme.colors) },
  faded: { opacity: 0.45 },
  status: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  statusText: { color: theme.colors.textMuted, fontSize: type.sub },

  stage: { flex: 1 },
  stageHead: {
    height: STAGE_HEAD,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  stageBody: {
    flex: 1,
    minHeight: 0,
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingBottom: space.xl,
  },
  side: { paddingTop: STAGE_COVER_GAP, gap: space.lg },
  stageNames: { gap: space.xs, marginTop: space.sm },
  // The display face, which carries its own weight: never bold it.
  stageTitle: { color: theme.colors.textPrimary, fontFamily: fonts.display },
  stageByline: { color: theme.colors.textSecondary, fontSize: type.sub },
  stageTransport: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  context: { color: theme.colors.textSecondary, fontSize: type.small, fontWeight: '600' },
  steps: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  phoneSteps: { justifyContent: 'space-between' },
  stepsBalance: { width: 44 },
  stageWays: { flex: 1, minWidth: 0 },
  stageFoot: { marginTop: 'auto', alignItems: 'flex-start' },
  stageWords: { flex: 1, minWidth: 0, position: 'relative' },
  // Where the words would be, rounded as Now Playing's visual is.
  stageVisual: {
    flex: 1,
    minWidth: 0,
    marginTop: STAGE_COVER_GAP,
    borderRadius: radius.cardLg,
    overflow: 'hidden',
  },
  tools: { position: 'absolute', top: 0, right: 0 },
  // Where the sung line will be once it plays: the words' column, a little above its middle.
  stageLine: { flex: 1, minWidth: 0, justifyContent: 'center', paddingBottom: '12%' },
  shared: { gap: space.xs },
  sharedAt: { color: theme.colors.textMuted, fontSize: type.small, fontWeight: '600' },
  sharedText: { color: theme.colors.textPrimary, fontWeight: '700' },
  sharedReading: {
    color: theme.colors.textSecondary,
    fontWeight: '500',
    fontStyle: 'italic',
    letterSpacing: 0.2,
  },

  phone: { flex: 1, paddingBottom: space.md },
  // The cover and the words, one over the other, above the controls they share.
  phoneViews: { flex: 1, minHeight: 0 },
  phoneControls: { alignSelf: 'center', gap: space.sm, paddingTop: space.md },
  layer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  phonePage: { paddingHorizontal: space.gutter, paddingTop: space.gutter },
  phoneArt: { alignSelf: 'center' },
  phoneColumn: { alignSelf: 'center', gap: space.lg },
  phoneNames: { gap: space.xs },
  phoneTitle: heroTitle(theme.colors, 'page'),
  phoneByline: { color: theme.colors.textSecondary, fontSize: type.body },
  phonePlay: { alignItems: 'center' },
  phoneFoot: { alignItems: 'center', paddingTop: space.md },
  // With the head's own top, the page's: the cover view's is the gutter.
  wordsPage: { paddingTop: space.xs },
  // In the bar's column, as the cover is: the page's one width.
  wordsHead: { alignSelf: 'center' },
  words: { marginTop: space.lg, alignSelf: 'center' },
  still: { gap: space.lg },
}))
