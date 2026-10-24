import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, PanResponder, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { artistOr, type RoomSong, type Song } from '@selfmp3/shared'
import { fonts, radius, space, type } from '@selfmp3/client'
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

/** Everything on the phone's cover view but the cover, for the cover to fit the screen beside. */
const PHONE_ROOM = 320
const PHONE_COVER_LEAST = 160
const PHONE_COVER_MOST = 420

interface SongProps {
  song: RoomSong
  /** The same song as the player has it, for its visual. */
  track: Song
  /** The player's id for it. */
  songId: number
  cover: string | null
  lyrics: SongLyrics
  /** The link lends words for it, so there are words to turn to. */
  lent: boolean
  /** It is the song the player has. */
  loaded: boolean
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
  const { song, track, cover, lyrics, lent, loaded, back, from, ways, foot } = props
  const { theme } = useUnistyles()
  const layout = useLayout()
  const windowHeight = useWindowValue(window => window.height)
  // Its own size once laid out: signed in, the sidebar and the bar take some of the window.
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const geometry = stageGeometry(
    size?.width ?? layout.width,
    (size?.height ?? windowHeight) - TRANSPORT_ROOM,
  )
  const words = lyrics.words
  const sides = { paddingLeft: geometry.pad, paddingRight: geometry.right }
  // Lent without words, or with words that would not read.
  const showVisual = !lent || words.status === 'missing'
  const sampler = useMotionSampler(track, showVisual)

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
        <View style={[styles.side, { width: geometry.cover }]}>
          <View style={styles.art}>
            <Cover uri={cover} title={song.title} size={geometry.cover} />
          </View>
          <View style={styles.stageNames}>
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
            <Play {...props} />
            <View style={styles.stageWays}>{ways}</View>
          </View>
          <View style={styles.stageFoot}>{foot}</View>
        </View>

        {showVisual ? (
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
  const { song, cover, lyrics, lent, loaded, back, from, ways, foot } = props
  const { wordsOpen, onWords } = props
  const { width } = useLayout()
  const height = useWindowValue(window => window.height)
  const insets = useSafeAreaInsets()
  // Whatever of the app floats over the page's foot: nothing while the link's
  // page owns the display, as it does now (`pageChrome.ts`).
  const chrome = useBottomInset()
  const words = lyrics.words
  // As big as the screen allows with Play still on it.
  const side = Math.max(
    PHONE_COVER_LEAST,
    Math.min(
      width - space.gutter * 2,
      PHONE_COVER_MOST,
      height - insets.top - insets.bottom - PHONE_ROOM - chrome,
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
            <View style={[styles.phoneColumn, { width: side }]}>
              {from}
              <View ref={coverTarget} collapsable={false} style={styles.art}>
                <Press
                  disabled={!lent}
                  onPress={() => onWords(true)}
                  accessibilityLabel={lent ? 'Show the lyrics' : undefined}
                >
                  <Cover uri={cover} title={song.title} size={side} />
                </Press>
              </View>
              <View style={styles.phoneNames}>
                <Text style={styles.phoneTitle} accessibilityRole="header" numberOfLines={2}>
                  {song.title}
                </Text>
                <Text style={styles.phoneByline} numberOfLines={2}>
                  {bylineOf(song)}
                </Text>
              </View>
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
            />
            <PhoneWordsBody
              words={words}
              fingerOnWords={fingerOnWords}
              still={!loaded}
              style={styles.words}
            />
          </Animated.View>
        ) : null}
      </View>

      <View style={[styles.phoneControls, { width: side }]}>
        <Seek song={song} loaded={loaded} />
        <View style={styles.phonePlay}>
          <Play {...props} size={64} />
        </View>
        {ways}
      </View>
      <View style={styles.phoneFoot}>{foot}</View>

      <Guide guide={guide} at={{ x: 0.5, y: 0.72 }} radius={18} steps={LYRICS_GUIDE_STEPS} />
    </View>
  )
}

/** An ended one-song link's head: its cover, faded, and its names. */
export function SongStill({
  song,
  cover,
  size,
}: {
  song: RoomSong
  cover: string | null
  size: number
}): ReactNode {
  return (
    <View style={styles.still}>
      <View style={[styles.art, styles.faded]}>
        <Cover uri={cover} title={song.title} size={size} />
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

  phone: { flex: 1, paddingBottom: space.md },
  // The cover and the words, one over the other, above the controls they share.
  phoneViews: { flex: 1, minHeight: 0 },
  phoneControls: { alignSelf: 'center', gap: space.sm, paddingTop: space.md },
  layer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  phonePage: { paddingHorizontal: space.gutter, paddingTop: space.gutter },
  phoneColumn: { alignSelf: 'center', gap: space.lg },
  phoneNames: { gap: space.xs },
  phoneTitle: heroTitle(theme.colors, 'page'),
  phoneByline: { color: theme.colors.textSecondary, fontSize: type.body },
  phonePlay: { alignItems: 'center' },
  phoneFoot: { alignItems: 'center', paddingTop: space.md },
  // With the head's own top, the page's: the cover view's is the gutter.
  wordsPage: { paddingTop: space.xs },
  // Past the page's sides, as Now Playing's words are, so a line's press wash has room.
  words: { marginTop: space.lg, marginHorizontal: -space.gutter },
  still: { gap: space.lg },
}))
