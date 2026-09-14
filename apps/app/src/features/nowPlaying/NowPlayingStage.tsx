import { useEffect, useRef, useState } from 'react'
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
import { useLocalSearchParams, useRouter } from 'expo-router'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import type { Song } from '@selfmp3/shared'
import {
  radius,
  rgba,
  tagColors,
  tempoMark,
  useLibrary,
  usePatchSong,
  withAlpha,
} from '@selfmp3/client'
import { useArt } from '../../offline/useArt'
import { usePlayer, usePlayerProgress } from '../../player/PlayerProvider'
import { leaveStage, setStageExit } from '../../shell/stageExit'
import { titleBarInset } from '../../ports/titleBarInset'
import { setStageIdle } from '../../shell/stageIdle'
import { useEscape } from '../../shell/useEscape'
import { useAccent } from '../../ui/accent'
import { Cover } from '../../ui/components/Cover'
import { EnergyWave } from '../../ui/components/EnergyWave'
import { IconButton } from '../../ui/components/IconButton'
import { ChevronDown, Collapse, Expand, Next, Romanize, TagPlus } from '../../ui/components/Icons'
import { SongDetailsBody } from '../../ui/components/SongDetails'
import { TagPicker } from '../../ui/components/TagPicker'
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
import { StageLyrics } from './StageLyrics'
import { StageQueue } from './StageQueue'
import { useCoverPalette } from './useCoverPalette'
import { useIdle } from './useIdle'
import { useSongWords } from './useSongWords'
import { tip } from '../../ui/tip'

/** The player bar's height: the page is the window above it. */
const BAR = 84
/*
 * Where the top row starts. The page covers the sidebar, which is what keeps
 * everything else clear of the Mac's traffic lights, and they sit on this
 * row's own line — so on the installed Mac app the row starts to their right
 * rather than under them. Twenty everywhere without an inset title bar.
 */
const HEAD_LEFT = titleBarInset > 0 ? 84 : 20
const MOVE_MS = 520
/** Opening and putting the page away: quick enough never to be waited for. */
const ENTER_MS = 260
const LEAVE_MS = 180

/**
 * The page for the song that is playing, on a computer: the web's
 * `NowPlayingPage`.
 *
 * One page with two modes. **Stage** is what the bar opens: the artwork and
 * what the app knows about the song on the left, and the lyrics, the queue or
 * the song's details on the right. **Focus** is the same page when only the
 * words matter: the cover glides into the header, the lyrics widen and grow,
 * and after a few still seconds the controls step aside.
 *
 * The page covers the sidebar but not the player bar, so play and pause never
 * move under your hand. Which tab and mode are showing live in the address,
 * so the bar's Queue button can open the page on its queue.
 */
export function NowPlayingStage(): ReactNode {
  const player = usePlayer()
  const router = useRouter()
  const params = useLocalSearchParams<{ tab?: string; mode?: string }>()
  const tab = parseTab(params.tab)
  const mode = parseMode(params.mode)
  const song = player.current

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
      onClose={close}
      onTab={next => router.setParams({ tab: next })}
      onMode={next => router.setParams({ mode: next })}
    />
  )
}

function EmptyStage({ onClose }: { onClose: () => void }): ReactNode {
  const { theme } = useUnistyles()
  useEscape(true, onClose)
  return (
    <View style={styles.page} accessibilityLabel="Now playing">
      <View style={styles.head}>
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

function Stage({
  song,
  tab,
  mode,
  onClose,
  onTab,
  onMode,
}: {
  song: Song
  tab: StageTab
  mode: PageMode
  onClose: () => void
  onTab: (tab: StageTab) => void
  onMode: (mode: PageMode) => void
}): ReactNode {
  const { theme } = useUnistyles()
  const player = usePlayer()
  const progress = usePlayerProgress()
  const accent = useAccent()
  const artFor = useArt()
  const library = useLibrary()
  const patchSong = usePatchSong()
  const lyrics = useSongWords(song)
  const uri = artFor(song)
  const palette = useCoverPalette(song, uri)
  // The key and the energy wave, like the player bar's lit controls.
  const songColor = useSongColor(song, uri)
  const window = useWindowDimensions()
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [tagsOpen, setTagsOpen] = useState(false)
  // The tag window opens over its button, as the song menu's does.
  const tagsButtonRef = useRef<View>(null)

  const focus = mode === 'focus'
  const shownTab: StageTab = focus ? 'lyrics' : tab
  const idle = useIdle(focus)
  // The player bar steps aside too, and comes back when anything moves.
  useEffect(() => {
    setStageIdle(idle)
  }, [idle])
  useEffect(() => () => setStageIdle(false), [])

  // The page comes up over the library and goes back down before the route
  // changes, rather than the router cutting between them.
  const [shown] = useState(() => new Animated.Value(0))
  useEffect(() => {
    Animated.timing(shown, {
      toValue: 1,
      duration: ENTER_MS,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: true,
    }).start()
    setStageExit(then => {
      Animated.timing(shown, {
        toValue: 0,
        duration: LEAVE_MS,
        easing: Easing.bezier(0.4, 0, 1, 1),
        useNativeDriver: true,
      }).start(() => then())
    })
    return () => setStageExit(null)
  }, [shown])
  const width = size?.width ?? window.width
  const height = size?.height ?? window.height - BAR
  const g = stageGeometry(width, height)

  const [move] = useState(() => new Animated.Value(focus ? 1 : 0))
  useEffect(() => {
    Animated.timing(move, {
      toValue: focus ? 1 : 0,
      duration: MOVE_MS,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: false,
    }).start()
  }, [focus, move])
  const between = (stage: number, focused: number): Animated.AnimatedInterpolation<number> =>
    move.interpolate({ inputRange: [0, 1], outputRange: [stage, focused] })

  useEscape(true, () => (focus ? onMode('stage') : onClose()))

  const words = lyrics.words
  const hasLyrics = words.status === 'lyrics'
  const tags = (library.data?.tags ?? []).filter(tag => song.tagIds.includes(tag.id))
  const features = song.features
  const upNext = player.songs[player.queue.index + 1]
  const nextIn = upNextSeconds({
    hasNext: upNext !== undefined,
    repeatOne: player.queue.repeat === 'one',
    duration: progress.duration,
    position: progress.position,
  })
  const chrome = { opacity: idle ? 0 : 1 }

  return (
    <Animated.View
      style={[
        styles.page,
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
      {/* The cover's own colours, blurred into light behind everything. */}
      <View pointerEvents="none" style={[styles.glow, { filter: 'blur(80px)' }]}>
        <View style={[styles.glowOne, { backgroundColor: rgba(palette[0], 1) }]} />
        <View style={[styles.glowTwo, { backgroundColor: rgba(palette[1], 1) }]} />
        <View style={[styles.glowThree, { backgroundColor: rgba(palette[2], 1) }]} />
      </View>
      {/* Stage darkens toward the words so they sit on something calm; Focus evenly. */}
      <Animated.View pointerEvents="none" style={[styles.fill, { opacity: between(1, 0) }]}>
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
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.fill,
          { opacity: move, backgroundColor: withAlpha(theme.colors.surface0, 0.55) },
        ]}
      />

      <Animated.View
        style={[
          styles.cover,
          chrome,
          {
            left: between(g.pad, 64),
            top: between(84, 10),
            width: between(g.cover, 40),
            height: between(g.cover, 40),
            borderRadius: between(12, 6),
          },
        ]}
      >
        {uri ? (
          <Image source={{ uri }} style={styles.coverImage} resizeMode="cover" />
        ) : (
          <Cover uri={null} title={song.album || song.title} size={focus ? 40 : g.cover} />
        )}
      </Animated.View>

      {focus ? null : (
        <View
          style={[
            styles.meta,
            { left: g.pad, top: 84 + g.cover + 24, width: Math.max(g.cover, 280) },
          ]}
        >
          <Text
            style={[
              styles.title,
              { fontSize: g.title, lineHeight: g.title * 1.15, letterSpacing: -0.02 * g.title },
            ]}
            numberOfLines={2}
            accessibilityRole="header"
          >
            {song.title}
          </Text>
          <Text style={styles.byline} numberOfLines={1}>
            {[song.artist || 'Unknown artist', song.album, song.year].filter(Boolean).join(' · ')}
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
            {tags.map(tag => (
              <Text key={tag.id} style={[styles.tag, { color: tagColors(tag.hue).text }]}>
                {tag.name}
              </Text>
            ))}
            <Pressable
              ref={tagsButtonRef}
              onPress={() => setTagsOpen(open => !open)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.tagButton, pressed && styles.tagButtonPressed]}
            >
              <TagPlus size={14} color={theme.colors.textSecondary} />
              <Text style={styles.tagButtonText}>{tags.length > 0 ? 'Edit tags' : 'Add tags'}</Text>
            </Pressable>
          </View>
        </View>
      )}

      <Animated.View
        style={[
          styles.words,
          {
            left: between(g.pad + g.cover + g.gutter, width * 0.12),
            right: between(g.right, width * 0.12),
            top: between(60, 56),
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
          ) : (
            <View style={styles.status}>
              {words.status === 'instrumental' ? (
                <Text style={styles.statusStrong}>Instrumental</Text>
              ) : words.offline ? (
                <Text style={styles.statusText}>
                  Lyrics need your library — reconnect to look them up
                </Text>
              ) : (
                <>
                  <Text style={styles.statusText}>No lyrics found</Text>
                  <Pressable
                    onPress={() => patchSong.mutate({ id: song.id, patch: { instrumental: true } })}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.statusLink, { color: accent.accent }]}>
                      It’s instrumental
                    </Text>
                  </Pressable>
                </>
              )}
            </View>
          )
        ) : shownTab === 'queue' ? (
          <StageQueue onClose={() => onTab('lyrics')} />
        ) : (
          <ScrollView contentContainerStyle={styles.about}>
            <View style={styles.aboutBody}>
              <SongDetailsBody song={song} />
            </View>
          </ScrollView>
        )}
      </Animated.View>

      <View style={[styles.head, chrome]}>
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
            <View style={styles.tabs} role="tablist" aria-label="Show">
              {(
                [
                  ['lyrics', 'Lyrics'],
                  ['queue', 'Up next'],
                  ['about', 'About'],
                ] as const
              ).map(([value, label]) => (
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
                  <Text style={[styles.tabText, shownTab === value && styles.tabTextActive]}>
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
      </View>

      {shownTab === 'lyrics' && hasLyrics && lyrics.language !== 'none' ? (
        <View
          style={[
            styles.tools,
            chrome,
            focus ? { top: 15, right: 66 } : { top: height - 48, right: g.right },
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
              color={lyrics.romanizationOn ? theme.colors.surface0 : theme.colors.textSecondary}
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
          accessibilityLabel={focus ? 'Back to the full page' : 'Show only the words'}
          {...tip(focus ? 'Back to the full page' : 'Lyrics')}
          style={({ pressed }) => [
            styles.expand,
            chrome,
            focus ? { top: 12, right: 20 } : { top: 68, right: g.right },
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

      {upNext && nextIn !== null ? (
        <Pressable
          onPress={player.next}
          accessibilityRole="button"
          accessibilityLabel={`Skip to the next song: ${upNext.title}`}
          style={[styles.upNext, { right: g.right, bottom: focus ? 28 : 64 }]}
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
      ) : null}

      <TagPicker
        song={tagsOpen ? song : null}
        onClose={() => setTagsOpen(false)}
        anchorRef={tagsButtonRef}
      />
    </Animated.View>
  )
}

const styles = StyleSheet.create(theme => ({
  page: { flex: 1, overflow: 'hidden', backgroundColor: theme.colors.surface0 },
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  glow: {
    position: 'absolute',
    top: '-15%',
    right: '-15%',
    bottom: '-15%',
    left: '-15%',
    opacity: 0.5,
  },
  glowOne: {
    position: 'absolute',
    left: '-5%',
    top: '5%',
    width: '55%',
    height: '70%',
    borderRadius: 9999,
  },
  glowTwo: {
    position: 'absolute',
    left: '30%',
    top: '50%',
    width: '55%',
    height: '60%',
    borderRadius: 9999,
    opacity: 0.7,
  },
  glowThree: {
    position: 'absolute',
    left: '70%',
    top: '-10%',
    width: '45%',
    height: '55%',
    borderRadius: 9999,
  },
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
    borderRadius: 9,
    backgroundColor: withAlpha(theme.colors.textPrimary, 0.07),
  },
  tab: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 7 },
  tabActive: { backgroundColor: withAlpha(theme.colors.textPrimary, 0.13) },
  tabText: { color: theme.colors.textSecondary, fontSize: 12.5, fontWeight: '600' },
  tabTextActive: { color: theme.colors.textPrimary },
  cover: {
    position: 'absolute',
    zIndex: 3,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 24 },
  },
  coverImage: { width: '100%', height: '100%' },
  meta: { position: 'absolute', zIndex: 2, gap: 10 },
  title: { color: theme.colors.textPrimary, fontWeight: '800' },
  byline: { color: theme.colors.textSecondary, fontSize: 14, marginTop: -4 },
  facts: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tempo: { color: theme.colors.textSecondary, fontSize: 14, fontVariant: ['tabular-nums'] },
  key: {
    height: 20,
    paddingHorizontal: 8,
    borderRadius: 5,
    justifyContent: 'center',
    backgroundColor: withAlpha(theme.colors.textPrimary, 0.08),
  },
  keyText: { fontSize: 12, fontWeight: '600' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  tag: { fontSize: 12, fontWeight: '500', paddingHorizontal: 2 },
  tagButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.colors.borderStrong,
  },
  tagButtonPressed: { backgroundColor: theme.colors.surface2 },
  tagButtonText: { color: theme.colors.textSecondary, fontSize: 12.5 },
  words: { position: 'absolute', zIndex: 1, bottom: 0 },
  status: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
  },
  statusText: { color: theme.colors.textMuted, fontSize: 13 },
  statusStrong: { color: theme.colors.textSecondary, fontSize: 13, fontWeight: '600' },
  statusLink: { fontSize: 13, fontWeight: '600' },
  about: { paddingTop: 12, paddingHorizontal: 4, paddingBottom: 40 },
  aboutBody: { maxWidth: 600 },
  tools: { position: 'absolute', zIndex: 4, flexDirection: 'row', gap: 6 },
  tool: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 11,
    borderRadius: 999,
    backgroundColor: withAlpha(theme.colors.textPrimary, 0.08),
  },
  toolOn: { backgroundColor: theme.colors.textPrimary },
  toolText: { color: theme.colors.textSecondary, fontSize: 12, fontWeight: '600' },
  toolTextOn: { color: theme.colors.surface0 },
  expand: {
    position: 'absolute',
    zIndex: 4,
    width: 36,
    height: 36,
    borderRadius: 10,
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
    borderRadius: radius.md,
    backgroundColor: withAlpha(theme.colors.surface2, 0.88),
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  upNextText: { minWidth: 0, maxWidth: 220 },
  upNextLabel: {
    color: theme.colors.textMuted,
    fontSize: 10.5,
    letterSpacing: 0.6,
    fontVariant: ['tabular-nums'],
  },
  upNextTitle: { color: theme.colors.textPrimary, fontSize: 13, fontWeight: '600' },
  upNextArtist: { color: theme.colors.textMuted, fontSize: 12 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  emptyTitle: { color: theme.colors.textSecondary, fontSize: 14, fontWeight: '600' },
  emptyText: { color: theme.colors.textMuted, fontSize: 13, textAlign: 'center' },
}))
