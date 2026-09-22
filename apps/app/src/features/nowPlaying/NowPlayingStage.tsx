import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import type { NativeStackNavigationProp } from 'expo-router'
import Svg, { Defs, Ellipse, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg'
import type { Song } from '@selfmp3/shared'
import type { Rgb } from '@selfmp3/client'
import { fonts, radius, tempoMark, useLibrary, withAlpha } from '@selfmp3/client'
import { useArt } from '../../offline/useArt'
import { usePlayer, usePlayerProgress } from '../../player/PlayerProvider'
import { leaveStage, setStageExit } from '../../shell/stageExit'
import { setStageArriving } from '../../shell/stageArrival'
import { stackMoves } from '../../ports/stackMoves'
import { titleBarInset } from '../../ports/titleBarInset'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { setStageIdle } from '../../shell/stageIdle'
import { useEscape } from '../../shell/useEscape'
import { Cover } from '../../ui/components/Cover'
import { EnergyWave } from '../../ui/components/EnergyWave'
import { Chip } from '../../ui/components/Chip'
import { IconButton } from '../../ui/components/IconButton'
import { ChevronDown, Collapse, Expand, Next, Romanize, TagPlus } from '../../ui/components/Icons'
import { TagPicker } from '../../ui/components/TagPicker'
import { SongFacts } from '../song/SongFacts'
import { songLink } from '../song/song.model'
import { useSongColor } from '../../ui/useSongColor'
import {
  contextLine,
  parseMode,
  parseTab,
  romanName,
  stageGeometry,
  upNextSeconds,
  type PageMode,
  type StageTab,
} from './nowPlaying.model'
import { useLayout } from '../../shell/useLayout'
import { PLAYER_BAR_HEIGHT } from '../../shell/PlayerBar'
import { ease, motionMs } from '../../ui/motion'
import { StageLyrics } from './StageLyrics'
import { Moving, useStageMove } from './StageMove'
import { coverPose, stackedTabsTop, stageCover, wordsFrame, wordsPose } from './stageMove.model'
import { SongVisual } from './SongVisual'
import { useMotionSampler } from './useMotionSampler'
import { useSongVisual } from './visualChoice'
import { motionCaption, rgbCss, VISUAL_NAMES } from './visuals.model'
import { VisualStyleMenu } from './VisualStyleMenu'
import { useCoverPalette } from './useCoverPalette'
import { useIdle } from './useIdle'
import { useSongWords } from './useSongWords'
import { ArtistLinks } from './ArtistLinks'
import { TaggingLine } from './TaggingLine'
import { useTagging, type Tagging } from './useTagging'
import { tagLink } from '../tag/placeLinks'
import { tip } from '../../ui/tip'
import { artShadow, floating, label } from '../../ui/surfaces'

/*
 * Where the top row starts. The page covers the sidebar, which is what keeps
 * everything else clear of the Mac's traffic lights, and they sit on this
 * row's own line — so on the installed desktop app the row starts to their right
 * rather than under them. Twenty everywhere without an inset title bar.
 */
const HEAD_LEFT = titleBarInset > 0 ? 84 : 20
/** Opening and putting the page away: quick enough never to be waited for. */
const ENTER_MS = 260
/** The visual finding its new place: it fades in there rather than gliding. */
const VISUAL_FADE_MS = 240
const LEAVE_MS = 180

/**
 * The page for the song that is playing, on a computer.
 *
 * One page with two modes. **Stage** is what the bar opens: the artwork and
 * what the app knows about the song on the left, and the lyrics or the song's
 * details on the right (`C09`). **Focus** is the same page when only the
 * words matter: the cover glides into the header, the lyrics widen and grow,
 * and after a few still seconds the controls step aside. Up next is not here:
 * it is the rail the player bar opens beside whatever page is showing.
 *
 * A song with no lyrics is its visual (`C10`): the first tab reads Visual and
 * the visual takes the column the words would have had, so the page is laid
 * out exactly as a song with words lays it out. The look it shows is picked
 * beside the tabs, and Focus gives the visual the window as it gives the
 * words the page.
 *
 * The page covers the sidebar but not the player bar, so play and pause never
 * move under your hand. Which tab and mode are showing live in the address.
 */
export function NowPlayingStage(): ReactNode {
  const player = usePlayer()
  const router = useRouter()
  const params = useLocalSearchParams<{ tab?: string; mode?: string }>()
  const tab = parseTab(params.tab)
  const mode = parseMode(params.mode)
  const song = player.current
  // Asked here rather than on the stage, so a queue that runs out ends it too.
  const tagging = useTagging()

  const close = (): void =>
    leaveStage(() => {
      if (router.canGoBack()) router.back()
      else router.replace('/')
    })

  if (!song) return <EmptyStage onClose={close} />

  return (
    <Stage
      song={song}
      tab={tab}
      mode={mode}
      tagging={tagging}
      onClose={close}
      onTab={next => router.setParams({ tab: next })}
      onMode={next => router.setParams({ mode: next })}
    />
  )
}

function EmptyStage({ onClose }: { onClose: () => void }): ReactNode {
  const { theme } = useUnistyles()
  const { top } = useSafeAreaInsets()
  useEscape(true, onClose)
  return (
    <View style={styles.page} accessibilityLabel="Now playing">
      <View style={[styles.head, { top }]}>
        <IconButton onPress={onClose} label="Close">
          <ChevronDown size={22} color={theme.colors.textSecondary} />
        </IconButton>
      </View>
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>Nothing playing</Text>
        <Text style={styles.emptyText}>Start a song and it turns up here, with its lyrics.</Text>
      </View>
    </View>
  )
}

/**
 * Three soft blooms of the cover's own colours, drawn as radial gradients.
 *
 * They were three round views under `filter: 'blur(80px)'`, which is a
 * browser's filter and nothing at all on a phone: on an iPad the same three
 * views drew as hard-edged discs crossing the page (Xiao, 2026-09-21). A
 * gradient with no hard stop is the blur, in one element, on both — and the
 * same shape in both places, which the CSS filter never was.
 *
 * Each bloom keeps the place and the size the views had, as a share of the
 * page, and the reach past its edges that let the light run on under the bar.
 */
function CoverGlow({ palette }: { palette: readonly Rgb[] }): ReactNode {
  const id = `glow${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const ink = (index: number): Rgb => palette[index] ?? palette[0] ?? [0, 0, 0]
  const blooms = [
    { at: [0.23, 0.4], size: [0.34, 0.42], ink: ink(0), alpha: 0.5 },
    { at: [0.58, 0.8], size: [0.34, 0.36], ink: ink(1), alpha: 0.35 },
    { at: [0.93, 0.18], size: [0.28, 0.33], ink: ink(2), alpha: 0.5 },
  ] as const
  return (
    <Svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 1 1">
      <Defs>
        {blooms.map((bloom, index) => (
          <RadialGradient key={index} id={`${id}${index}`} cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor={rgbCss(bloom.ink)} stopOpacity={bloom.alpha} />
            <Stop offset="0.55" stopColor={rgbCss(bloom.ink)} stopOpacity={bloom.alpha * 0.55} />
            <Stop offset="1" stopColor={rgbCss(bloom.ink)} stopOpacity={0} />
          </RadialGradient>
        ))}
      </Defs>
      {blooms.map((bloom, index) => (
        <Ellipse
          key={index}
          cx={bloom.at[0]}
          cy={bloom.at[1]}
          rx={bloom.size[0]}
          ry={bloom.size[1]}
          fill={`url(#${id}${index})`}
        />
      ))}
    </Svg>
  )
}

function Stage({
  song,
  tab,
  mode,
  tagging,
  onClose,
  onTab,
  onMode,
}: {
  song: Song
  tab: StageTab
  mode: PageMode
  tagging: Tagging
  onClose: () => void
  onTab: (tab: StageTab) => void
  onMode: (mode: PageMode) => void
}): ReactNode {
  const { theme } = useUnistyles()
  // Under an iPad's status bar, not behind it; a computer's window has none.
  const { top } = useSafeAreaInsets()
  const { finePointer } = useLayout()
  const player = usePlayer()
  const router = useRouter()
  const artFor = useArt()
  const library = useLibrary()
  const lyrics = useSongWords(song)
  const visual = useSongVisual(song)
  const [styleOpen, setStyleOpen] = useState(false)
  const styleButtonRef = useRef<View>(null)
  const uri = artFor(song)
  const palette = useCoverPalette(song, uri)
  // The key and the energy wave, like the player bar's lit controls.
  const songColor = useSongColor(song, uri)
  const window = useWindowDimensions()
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [tagsOpen, setTagsOpen] = useState(false)
  // The tag window opens over its button, as the song menu's does.
  const tagsButtonRef = useRef<View>(null)
  // The tag window hangs from its button, so play-and-tag raises it only once
  // the page has come to rest: measured mid-rise, it sat below its button.
  const [entered, setEntered] = useState(false)

  const focus = mode === 'focus'
  const shownTab: StageTab = focus ? 'lyrics' : tab
  // Only where a pointer can say it is still there: on a touch screen nothing
  // reports activity (`ports/activity`), so the bar went away and stayed away.
  const idle = useIdle(focus && finePointer)
  // The player bar steps aside too, and comes back when anything moves.
  useEffect(() => {
    setStageIdle(idle)
  }, [idle])
  useEffect(() => () => setStageIdle(false), [])

  // Where the navigator plays nothing (`stackMoves`: a browser, the desktop
  // app) the page comes up over the library itself and goes back down before
  // the route changes, rather than the router cutting between them. On an
  // iPad the native stack slides it up and down, and that is the whole move:
  // with both running, closing faded the page away over its own dark ground
  // and then slid that empty ground down off the library like a blind, which
  // looked like Home being drawn again from the top (Xiao's recording,
  // 2026-09-21).
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, object | undefined>>>()
  const [shown] = useState(() => new Animated.Value(stackMoves ? 1 : 0))
  useEffect(() => {
    if (stackMoves) {
      // The navigator says when its slide starts and when it is over. Only it
      // knows: the slide begins when the native side is ready and runs on its
      // own clock, and a timer counted from here was a quarter of a second
      // early on an iPad. The end counts as a start too, should the start
      // have come before this was listening.
      const offStart = navigation.addListener('transitionStart', event => {
        if (!event.data.closing) setStageArriving(true)
      })
      const offEnd = navigation.addListener('transitionEnd', event => {
        if (event.data.closing) return
        setStageArriving(true)
        setEntered(true)
      })
      return () => {
        offStart()
        offEnd()
        setStageArriving(false)
      }
    }
    setStageArriving(true)
    Animated.timing(shown, {
      toValue: 1,
      duration: motionMs(ENTER_MS),
      easing: ease.out,
      useNativeDriver: true,
    }).start(() => setEntered(true))
    setStageExit(then => {
      Animated.timing(shown, {
        toValue: 0,
        duration: motionMs(LEAVE_MS),
        easing: ease.in,
        useNativeDriver: true,
      }).start(() => then())
    })
    return () => {
      setStageExit(null)
      setStageArriving(false)
    }
  }, [shown, navigation])
  const width = size?.width ?? window.width
  // The page runs on under the player bar (`stagePage`), so what it lays out
  // in is its own height less the bar's, whether the bar is showing or not.
  const height = (size?.height ?? window.height) - PLAYER_BAR_HEIGHT
  const g = useMemo(() => stageGeometry(width, height, top), [width, height, top])
  // Nothing laid out moves between the modes: each piece is laid out where the
  // mode puts it and carried there (stageMove.model.ts says why).
  const move = useStageMove(focus)
  const frame = wordsFrame(width, g, focus ? 1 : 0)

  // Escape asks the mode when it is pressed, so the page listens once rather
  // than taking the listener off and putting it back on every render.
  const escape = useRef(onClose)
  useEffect(() => {
    escape.current = focus ? () => onMode('stage') : onClose
  })
  const onEscape = useCallback(() => escape.current(), [])
  useEscape(true, onEscape)

  const words = lyrics.words
  const hasLyrics = words.status === 'lyrics'
  // Not while offline: the words may exist, and there is text to say why they are not here.
  const noLyrics = words.status === 'missing' && !words.offline
  const sampler = useMotionSampler(song, noLyrics)
  // Only on its own tab: About is text, and wants the calm ground.
  const showVisual = noLyrics && shownTab === 'lyrics'
  const box = stageCover(g)
  /*
   * The visual does not glide between the column and the window: a canvas
   * stretched from one to the other is a smear, and one resized every frame
   * is a redraw at a new size every frame. It is laid out where the mode puts
   * it and fades in there, over the half-second the cover takes to travel.
   */
  const [visualFade] = useState(() => new Animated.Value(1))
  useEffect(() => {
    if (!showVisual) return undefined
    visualFade.setValue(0)
    const run = Animated.timing(visualFade, {
      toValue: 1,
      duration: motionMs(VISUAL_FADE_MS),
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    })
    run.start()
    return () => run.stop()
  }, [focus, showVisual, visualFade])
  const tabs: readonly (readonly [StageTab, string])[] = [
    ['lyrics', noLyrics ? 'Visual' : 'Lyrics'],
    ['about', 'About'],
  ]
  const tags = (library.data?.tags ?? []).filter(tag => song.tagIds.includes(tag.id))
  const features = song.audioFeatures
  const chrome = { opacity: idle ? 0 : 1 }
  // The title is not a row's own tap target, so it opens the song (Phase 5).
  // Pushed over the page, as a tag or an artist is, so back comes to it again.
  const openSong = (): void => router.push(songLink(song.id))

  // Beside Visual and About on the stage; in Focus, where the tabs are put
  // away, at the top right where the romaji switch sits for a song with words.
  const stylePill = showVisual ? (
    <Pressable
      ref={styleButtonRef}
      onPress={() => setStyleOpen(open => !open)}
      accessibilityRole="button"
      accessibilityLabel={`Style: ${visual.chosen ? '' : 'Auto, '}${VISUAL_NAMES[visual.kind]}`}
      aria-haspopup="menu"
      aria-expanded={styleOpen}
      style={({ pressed }) => [styles.tool, (pressed || styleOpen) && styles.toolPressed]}
    >
      <Text style={styles.toolText}>{VISUAL_NAMES[visual.kind]}</Text>
      <ChevronDown size={13} color={theme.colors.textSecondary} />
    </Pressable>
  ) : null

  const tabList = (
    <View style={styles.tabs} role="tablist" aria-label="Show">
      {tabs.map(([value, label]) => (
        <Pressable
          key={value}
          role="tab"
          aria-selected={shownTab === value}
          onPress={() => onTab(value)}
          style={({ pressed }) => [
            styles.tab,
            shownTab === value && styles.tabActive,
            pressed && styles.tabActive,
          ]}
        >
          <Text style={[styles.tabText, shownTab === value && styles.tabTextActive]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  )
  // Stacked (`T05`), the tabs leave the head for a row under the cover, with
  // Romaji and expand at its other end.
  const tabsRow = g.stacked && !focus ? stackedTabsTop(g) : null

  return (
    <Animated.View
      style={[
        styles.page,
        styles.stagePage,
        {
          opacity: shown,
          transform: [
            { translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) },
            { scale: shown.interpolate({ inputRange: [0, 1], outputRange: [0.985, 1] }) },
          ],
        },
      ]}
      accessibilityLabel={`Now playing: ${song.title}`}
      onLayout={event => {
        const { width: w, height: h } = event.nativeEvent.layout
        setSize(current =>
          current?.width === w && current.height === h ? current : { width: w, height: h },
        )
      }}
    >
      {/* The cover's own colours as light behind everything. Sized by the page
          above the bar, as it always was; the light reaches past the edges so
          it runs on under the bar for when Focus puts it away. */}
      <View pointerEvents="none" style={[styles.fill, { bottom: PLAYER_BAR_HEIGHT }]}>
        <CoverGlow palette={palette} />
      </View>
      {/* Stage darkens toward the words so they sit on something calm; Focus evenly. */}
      <Moving move={move} pose={m => ({ opacity: 1 - m })} pointerEvents="none" style={styles.fill}>
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id="np-shade" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={theme.colors.surface0} stopOpacity={0.35} />
              <Stop offset="0.55" stopColor={theme.colors.surface0} stopOpacity={0.82} />
              <Stop offset="1" stopColor={theme.colors.surface0} stopOpacity={0.82} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#np-shade)" />
        </Svg>
      </Moving>
      <Moving
        move={move}
        pose={m => ({ opacity: m })}
        pointerEvents="none"
        style={[styles.fill, { backgroundColor: withAlpha(theme.colors.surface0, 0.55) }]}
      />

      {/* Laid out at the stage's size always, and scaled into the header for
          Focus: its artwork and its shadow shrink with it. */}
      <Moving
        move={move}
        pose={m => coverPose(box, m, g.inset)}
        style={[
          styles.cover,
          chrome,
          { left: box.left, top: box.top, width: box.size, height: box.size },
        ]}
      >
        {uri ? (
          <Image source={{ uri }} style={styles.coverImage} resizeMode="cover" />
        ) : (
          <Cover uri={null} title={song.album || song.title} size={box.size} />
        )}
      </Moving>

      {focus ? null : (
        <View
          style={[
            styles.meta,
            g.stacked
              ? // Beside the cover, as a tag page's name is.
                { left: box.left + box.size + g.gutter, top: box.top + 16, right: g.right }
              : { left: g.pad, top: box.top + box.size + 24, width: Math.max(g.cover, 280) },
          ]}
        >
          <Text
            style={[
              styles.title,
              {
                fontSize: g.title,
                lineHeight: g.title * 1.15,
                letterSpacing: -0.02 * g.title,
              },
            ]}
            numberOfLines={2}
            onPress={openSong}
            accessibilityRole="link"
            accessibilityLabel={`${song.title}: song details`}
            testID="now-playing-info"
          >
            {song.title}
          </Text>
          <Text style={styles.byline} numberOfLines={1}>
            <ArtistLinks artist={song.artist} />
            {[song.album, song.year]
              .filter(Boolean)
              .map(part => ` · ${part}`)
              .join('')}
          </Text>
          {features && (features.bpm != null || features.energy != null || features.camelot) ? (
            <View style={styles.facts}>
              {features.bpm != null ? (
                <Text style={styles.tempo}>{tempoMark(features.bpm)}</Text>
              ) : null}
              {features.camelot ? (
                <View style={styles.key}>
                  <Text style={[styles.keyText, { color: songColor.color }]}>
                    {features.camelot}
                  </Text>
                </View>
              ) : null}
              {features.energy != null ? (
                <EnergyWave
                  energy={features.energy}
                  width={34}
                  height={16}
                  color={songColor.color}
                />
              ) : null}
            </View>
          ) : null}
          <View style={styles.tags}>
            {/* Each tag is a place of its own: its chip opens its page. */}
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
              ref={tagsButtonRef}
              // In play-and-tag the button is the mode's editor, raised again or put away.
              onPress={() =>
                tagging.on
                  ? tagging.open
                    ? tagging.close()
                    : tagging.raise()
                  : setTagsOpen(open => !open)
              }
              accessibilityRole="button"
              style={({ pressed }) => [styles.tagButton, pressed && styles.tagButtonPressed]}
            >
              <TagPlus size={14} color={theme.colors.textSecondary} />
              <Text style={styles.tagButtonText}>{tags.length > 0 ? 'Edit tags' : 'Add tags'}</Text>
            </Pressable>
          </View>
          {tagging.on ? <TaggingLine line={tagging.line} onStop={tagging.stop} /> : null}
        </View>
      )}

      {/* No words: the visual takes the words' column, and Focus gives it the
          window — the two places the words themselves have. */}
      {showVisual ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.visual,
            focus
              ? styles.visualFull
              : {
                  left: frame.left,
                  right: frame.right,
                  top: frame.top,
                  bottom: PLAYER_BAR_HEIGHT,
                  borderRadius: radius.cardLg,
                },
            { opacity: visualFade },
          ]}
        >
          <SongVisual song={song} kind={visual.kind} sampler={sampler} cover={uri} />
        </Animated.View>
      ) : null}

      {/* At the mode's own width from the first frame, slid from where the
          other mode had it. In Focus it runs to the foot of the window, under
          the bar, so the bar stepping aside does not change its height — which
          would move the sung line and re-centre every word. */}
      <Moving
        move={move}
        pose={m => wordsPose(width, g, focus, m)}
        style={[
          styles.words,
          {
            left: frame.left,
            right: frame.right,
            top: frame.top,
            bottom: focus ? 0 : PLAYER_BAR_HEIGHT,
          },
        ]}
      >
        {shownTab === 'lyrics' ? (
          words.status === 'loading' ? (
            <View style={styles.status}>
              <ActivityIndicator size="small" color={theme.colors.textMuted} />
              <Text style={styles.statusText}>Looking for lyrics…</Text>
            </View>
          ) : words.status === 'lyrics' ? (
            <StageLyrics
              parsed={words.parsed}
              roman={words.roman}
              focus={focus}
              fontSize={focus ? g.focusLyric : g.lyric}
            />
          ) : noLyrics ? null : (
            <View style={styles.status}>
              <Text style={styles.statusText}>
                Lyrics need your library — reconnect to look them up
              </Text>
            </View>
          )
        ) : (
          <ScrollView contentContainerStyle={styles.about}>
            <View style={styles.aboutBody}>
              <SongFacts song={song} />
            </View>
          </ScrollView>
        )}
      </Moving>

      <View style={[styles.head, { top }, chrome]}>
        <IconButton
          onPress={focus ? () => onMode('stage') : onClose}
          label={focus ? 'Back to the full page' : 'Close now playing'}
          caption={focus ? 'Back to the full page' : 'Close'}
        >
          <ChevronDown size={22} color={theme.colors.textSecondary} />
        </IconButton>
        {focus ? (
          <View style={styles.headSong} pointerEvents="none">
            <Text style={styles.headTitle} numberOfLines={1}>
              {song.title}
            </Text>
            <Text style={styles.headArtist} numberOfLines={1}>
              {song.artist || 'Unknown artist'}
            </Text>
          </View>
        ) : (
          <>
            <Text style={styles.context} pointerEvents="none">
              {contextLine(player.queue.shuffle, player.queue.index, player.queue.items.length)}
            </Text>
            {g.stacked ? null : (
              <>
                {tabList}
                {stylePill}
              </>
            )}
          </>
        )}
      </View>

      {tabsRow !== null ? (
        <View style={[styles.tools, chrome, { top: tabsRow, left: g.pad }]}>
          {tabList}
          {stylePill}
        </View>
      ) : null}

      {focus && stylePill ? (
        <View style={[styles.tools, chrome, { top: top + 12, right: 66 }]}>{stylePill}</View>
      ) : null}

      {shownTab === 'lyrics' && hasLyrics && lyrics.language !== 'none' ? (
        <View
          style={[
            styles.tools,
            chrome,
            focus
              ? { top: top + 15, right: 66 }
              : tabsRow !== null
                ? { top: tabsRow + 4, right: g.right + 52 }
                : { top: height - 48, right: g.right },
          ]}
        >
          <Pressable
            role="button"
            aria-pressed={lyrics.romanizationOn}
            onPress={() => lyrics.setRomanization(!lyrics.romanizationOn)}
            accessibilityHint={`${lyrics.romanizationOn ? 'Hide' : 'Show'} ${romanName(lyrics.language).toLowerCase()} under each line`}
            style={[styles.tool, lyrics.romanizationOn && styles.toolOn]}
          >
            <Romanize
              size={14}
              color={lyrics.romanizationOn ? theme.colors.onPrimary : theme.colors.textSecondary}
            />
            <Text style={[styles.toolText, lyrics.romanizationOn && styles.toolTextOn]}>
              {romanName(lyrics.language)}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {shownTab === 'lyrics' ? (
        <Pressable
          onPress={() => onMode(focus ? 'stage' : 'focus')}
          accessibilityRole="button"
          accessibilityLabel={
            focus
              ? 'Back to the full page'
              : showVisual
                ? 'Show only the visual'
                : 'Show only the words'
          }
          {...tip(focus ? 'Back to the full page' : showVisual ? 'Visual' : 'Lyrics')}
          style={({ pressed }) => [
            styles.expand,
            chrome,
            focus ? { top: top + 12, right: 20 } : { top: tabsRow ?? top + 68, right: g.right },
            pressed && styles.expandPressed,
          ]}
        >
          {focus ? (
            <Collapse size={18} color={theme.colors.textSecondary} />
          ) : (
            <Expand size={18} color={theme.colors.textSecondary} />
          )}
        </Pressable>
      ) : null}

      <StageUpNext
        upNext={player.songs[player.queue.index + 1]}
        repeatOne={player.queue.repeat === 'one'}
        right={g.right}
        bottom={PLAYER_BAR_HEIGHT + (focus ? 28 : 64)}
        lowered={idle}
      />

      <VisualStyleMenu
        open={styleOpen && noLyrics}
        onClose={() => setStyleOpen(false)}
        anchorRef={styleButtonRef}
        visual={visual}
        following={motionCaption(sampler.source)}
        onLookAgain={lyrics.lookAgain}
      />

      {/* Focus has no tag button to hang it from: play-and-tag waits for the full page. */}
      <TagPicker
        song={tagsOpen || (tagging.open && entered && !focus) ? song : null}
        onClose={() => {
          setTagsOpen(false)
          if (tagging.open) tagging.close()
        }}
        anchorRef={tagsButtonRef}
      />
    </Animated.View>
  )
}

/**
 * "Next · in 12 s", near a song's end.
 *
 * The one part of the page that reads where the song has got to, so it asks
 * for that itself: when the page asked, every tick redrew all of it — the
 * glow's 80px blur, the gradient, the tags — to change one number here.
 */
function StageUpNext({
  upNext,
  repeatOne,
  right,
  bottom,
  lowered,
}: {
  upNext: Song | undefined
  repeatOne: boolean
  right: number
  bottom: number
  /** With the player bar put away, the page grown down into its room. */
  lowered: boolean
}): ReactNode {
  const { theme } = useUnistyles()
  const player = usePlayer()
  const artFor = useArt()
  const progress = usePlayerProgress()
  const nextIn = upNextSeconds({
    hasNext: upNext !== undefined,
    repeatOne,
    duration: progress.duration,
    position: progress.position,
  })
  if (!upNext || nextIn === null) return null

  return (
    <Pressable
      onPress={player.next}
      accessibilityRole="button"
      accessibilityLabel={`Skip to the next song: ${upNext.title}`}
      style={[
        styles.upNext,
        { right, bottom },
        lowered && { transform: [{ translateY: PLAYER_BAR_HEIGHT }] },
      ]}
    >
      <Cover uri={artFor(upNext)} title={upNext.album || upNext.title} size={40} />
      <View style={styles.upNextText}>
        <Text style={styles.upNextLabel}>NEXT · IN {nextIn} S</Text>
        <Text style={styles.upNextTitle} numberOfLines={1}>
          {upNext.title}
        </Text>
        <Text style={styles.upNextArtist} numberOfLines={1}>
          {upNext.artist || 'Unknown artist'}
        </Text>
      </View>
      <Next size={16} color={theme.colors.textSecondary} />
    </Pressable>
  )
}

const styles = StyleSheet.create(theme => ({
  page: { flex: 1, overflow: 'hidden', backgroundColor: theme.colors.surface0 },
  /*
   * The page reaches down under the player bar, which the shell draws over it.
   * Focus puts the bar away by fading it rather than taking it out: taking it
   * out made the page 84px taller and back again at every still mouse, and
   * each time the lyrics measured a new height, re-centred and redrew every
   * line. Now the page is one height, and what shows where the bar was is the
   * page's own light rather than the frame behind it.
   */
  stagePage: { marginBottom: -PLAYER_BAR_HEIGHT },
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  head: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: HEAD_LEFT,
    paddingRight: 20,
    zIndex: 4,
  },
  // Beside the chevron, however far the row starts.
  headSong: { position: 'absolute', left: 96 + HEAD_LEFT, top: 12, maxWidth: '40%' },
  headTitle: { color: theme.colors.textPrimary, fontSize: 14, fontWeight: '700' },
  headArtist: { color: theme.colors.textSecondary, fontSize: 12 },
  context: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    color: theme.colors.textMuted,
    fontSize: 12,
  },
  tabs: {
    marginLeft: 'auto',
    flexDirection: 'row',
    gap: 2,
    padding: 3,
    borderRadius: radius.pill,
    backgroundColor: withAlpha(theme.colors.textPrimary, 0.07),
  },
  tab: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.pill },
  // The chosen tab is the selected tone, as a chosen segment is (`S2`).
  tabActive: { backgroundColor: theme.colors.surfaceSelected },
  tabText: { color: theme.colors.textSecondary, fontSize: 12.5, fontWeight: '600' },
  tabTextActive: { color: theme.colors.textPrimary },
  cover: {
    position: 'absolute',
    zIndex: 3,
    overflow: 'hidden',
    ...artShadow(theme.colors),
  },
  coverImage: { width: '100%', height: '100%' },
  meta: { position: 'absolute', zIndex: 2, gap: 10 },
  // The display face, which carries its own weight: never bold it.
  title: { color: theme.colors.textPrimary, fontFamily: fonts.display },
  byline: { color: theme.colors.textSecondary, fontSize: 14, marginTop: -4 },
  facts: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tempo: { color: theme.colors.textSecondary, fontSize: 14, fontVariant: ['tabular-nums'] },
  key: {
    height: 20,
    paddingHorizontal: 8,
    borderRadius: radius.pill,
    justifyContent: 'center',
    backgroundColor: withAlpha(theme.colors.textPrimary, 0.08),
  },
  keyText: { fontSize: 12, fontWeight: '600' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  tagButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    // The dashed edge is the mark itself: an add chip (`S2`).
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.colors.borderStrong,
  },
  tagButtonPressed: { backgroundColor: theme.colors.surface2 },
  tagButtonText: { color: theme.colors.textSecondary, fontSize: 12.5 },
  words: { position: 'absolute', zIndex: 1 },
  status: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
  },
  statusText: { color: theme.colors.textMuted, fontSize: 13 },
  visual: { position: 'absolute', overflow: 'hidden', zIndex: 1 },
  visualFull: { left: 0, right: 0, top: 0, bottom: 0 },
  about: { paddingTop: 12, paddingHorizontal: 4, paddingBottom: 40 },
  aboutBody: { maxWidth: 600, paddingHorizontal: 18 },
  tools: { position: 'absolute', zIndex: 4, flexDirection: 'row', gap: 6 },
  tool: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 11,
    borderRadius: radius.pill,
    backgroundColor: withAlpha(theme.colors.textPrimary, 0.08),
  },
  toolOn: { backgroundColor: theme.colors.textPrimary },
  toolPressed: { backgroundColor: withAlpha(theme.colors.textPrimary, 0.14) },
  toolText: { color: theme.colors.textSecondary, fontSize: 12, fontWeight: '600' },
  toolTextOn: { color: theme.colors.onPrimary },
  expand: {
    position: 'absolute',
    zIndex: 4,
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(theme.colors.textPrimary, 0.08),
  },
  expandPressed: { backgroundColor: withAlpha(theme.colors.textPrimary, 0.14) },
  upNext: {
    position: 'absolute',
    zIndex: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingLeft: 8,
    paddingRight: 12,
    borderRadius: radius.card,
    // It floats over the stage, so it is glass and casts the one shadow.
    backgroundColor: theme.colors.glass,
    ...floating(theme.colors),
  },
  upNextText: { minWidth: 0, maxWidth: 220 },
  upNextLabel: {
    ...label(theme.colors),
    fontVariant: ['tabular-nums'],
  },
  upNextTitle: { color: theme.colors.textPrimary, fontSize: 13, fontWeight: '600' },
  upNextArtist: { color: theme.colors.textMuted, fontSize: 12 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  emptyTitle: { color: theme.colors.textSecondary, fontSize: 14, fontWeight: '600' },
  emptyText: { color: theme.colors.textMuted, fontSize: 13, textAlign: 'center' },
}))
