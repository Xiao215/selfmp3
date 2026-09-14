import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet as NativeStyleSheet,
  Text,
  View,
} from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg'
import { useRouter } from 'expo-router'
import { WRAPPED_RANGE_LABELS, type Song, type WrappedRange } from '@selfmp3/shared'
import { radius, withAlpha } from '@selfmp3/client'
import { useLibrary, useWrapped } from '../../api/queries'
import { useArt } from '../../offline/useArt'
import { usePlayer } from '../../player/PlayerProvider'
import { canShareCard, shareWrappedCard } from '../../ports/shareCard'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../../ui/accent'
import { Button } from '../../ui/components/Button'
import { Cover } from '../../ui/components/Cover'
import { Download, Play, Sparkles } from '../../ui/components/Icons'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { Segmented } from '../../ui/components/Segmented'
import { SongLine } from '../stats/SongLine'
import { longDate, playsLabel } from '../stats/stats.model'
import {
  discoveredChapter,
  emptyHint,
  emptyTitle,
  eyebrow,
  facts,
  figure,
  figureUnit,
  longerRanges,
  numberOneLine,
  RANGE_SHORT,
  rankShare,
  repeatNote,
  tryLabel,
  WRAPPED_RANGES,
} from './wrapped.model'

const GAP = 14
const CHAPTER_MIN = 330

/**
 * Wrapped, for any window you like: the web's `WrappedView`.
 *
 * The one screen allowed to be a bit of a show: the top song's artwork blurred
 * behind the hero, the figure set large, each section a numbered chapter. It
 * keeps the app's type scale, spacing and accent, so it reads as the same app
 * in its good coat.
 */
export function WrappedScreen(): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const router = useRouter()
  const player = usePlayer()
  const artFor = useArt()
  const { wide } = useLayout()
  const [range, setRange] = useState<WrappedRange>('month')
  const { data: wrapped, isLoading } = useWrapped(range)
  const { data: library } = useLibrary()
  const [sharing, setSharing] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)
  const [gridWidth, setGridWidth] = useState(0)

  const songById = useMemo(
    () => new Map((library?.songs ?? []).map(song => [song.id, song])),
    [library],
  )

  const share = async (): Promise<void> => {
    if (!wrapped) return
    setSharing(true)
    setShareError(null)
    // The number one's cover, as the page shows it behind the figure and in its card.
    const top = wrapped.topSongs[0]
    const topSongInLibrary = top ? songById.get(top.songId) : undefined
    try {
      await shareWrappedCard(
        wrapped,
        {
          background: theme.colors.surface0,
          surface: theme.colors.surface1,
          border: theme.colors.border,
          accent: accent.accent,
          accentDim: accent.accentDim,
          bar: theme.colors.chartSeries,
          text: theme.colors.textPrimary,
          secondary: theme.colors.textSecondary,
          muted: theme.colors.textMuted,
        },
        topSongInLibrary ? artFor(topSongInLibrary) : null,
      )
    } catch (error) {
      setShareError(error instanceof Error ? error.message : 'could not make the image')
    } finally {
      setSharing(false)
    }
  }

  /** Play a list of top entries, the ones still in the library. */
  const playTop = (ids: readonly number[]): void => {
    const present = ids.filter(id => songById.has(id))
    if (present.length > 0) player.playFrom(present, 0)
  }

  const header = (
    <View style={[styles.head, !wide && styles.headNarrow]}>
      <View>
        <Text style={[styles.heading, !wide && styles.headingNarrow]} accessibilityRole="header">
          Wrapped
        </Text>
        <Text style={styles.sub}>
          {WRAPPED_RANGE_LABELS[range]} ·{' '}
          <Text
            style={[styles.link, { color: accent.accent }]}
            onPress={() => router.push('/stats')}
            accessibilityRole="link"
          >
            back to stats
          </Text>
        </Text>
      </View>
      <View style={[styles.actions, !wide && styles.actionsNarrow]}>
        <Segmented
          value={range}
          onChange={setRange}
          label="Wrapped range"
          options={WRAPPED_RANGES.map(option => ({ value: option, label: RANGE_SHORT[option] }))}
        />
        {canShareCard ? (
          <Button
            label={sharing ? 'Rendering…' : 'Share as image'}
            variant="primary"
            icon={<Download size={15} color={accent.onAccent} />}
            disabled={!wrapped || wrapped.totals.plays === 0 || sharing}
            onPress={() => void share()}
          />
        ) : null}
      </View>
    </View>
  )

  const shell = (children: ReactNode): ReactNode => (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={[styles.content, wide ? styles.contentWide : styles.contentNarrow]}
        testID="wrapped-screen"
      >
        {header}
        {children}
      </ScrollView>
    </SafeAreaView>
  )

  if (isLoading && !wrapped) return shell(<Text style={styles.hint}>Working it out…</Text>)

  if (!wrapped) {
    return shell(
      <View style={styles.empty}>
        <Text style={styles.chapterTitle}>Wrapped needs your library</Text>
        <Text style={[styles.hint, styles.center]}>
          It’ll be here when your server is reachable again.
        </Text>
      </View>,
    )
  }

  if (wrapped.totals.plays === 0) {
    return shell(
      <View style={styles.empty}>
        <Text style={styles.emoji}>🎁</Text>
        <Text style={styles.chapterTitle}>{emptyTitle(range)}</Text>
        <Text style={[styles.hint, styles.center]}>{emptyHint(range)}</Text>
        <View style={styles.emptyActions}>
          {longerRanges(range).map(option => (
            <Button key={option} label={tryLabel(option)} onPress={() => setRange(option)} />
          ))}
          <Button
            label="Go to the library"
            variant="primary"
            icon={<Play size={15} color={accent.onAccent} />}
            onPress={() => router.push('/')}
          />
        </View>
      </View>,
    )
  }

  const topSong = wrapped.topSongs[0]
  const topInLibrary: Song | undefined = topSong ? songById.get(topSong.songId) : undefined
  const heroArt = topInLibrary ? artFor(topInLibrary) : null
  const columns = wide ? Math.max(1, Math.floor((gridWidth + GAP) / (CHAPTER_MIN + GAP))) : 1
  const chapterWidth = gridWidth > 0 && columns > 1 ? (gridWidth - GAP) / 2 : undefined

  return shell(
    <>
      {shareError ? (
        <View style={styles.notice} accessibilityRole="alert">
          <Text style={styles.noticeText}>{shareError}</Text>
        </View>
      ) : null}

      <View style={styles.hero}>
        {/* The top song's artwork, blurred past recognition: decoration that is also data. */}
        {heroArt ? (
          <Image source={{ uri: heroArt }} blurRadius={42} style={styles.heroArt} aria-hidden />
        ) : null}
        <Svg style={NativeStyleSheet.absoluteFill} width="100%" height="100%" pointerEvents="none">
          <Defs>
            <LinearGradient id="wash" x1="0" y1="0" x2="1" y2="0.2">
              <Stop offset="0.04" stopColor={theme.colors.surface1} stopOpacity={heroArt ? 1 : 0} />
              <Stop
                offset="0.38"
                stopColor={theme.colors.surface1}
                stopOpacity={heroArt ? 0.78 : 0}
              />
              <Stop offset="1" stopColor={theme.colors.surface1} stopOpacity={heroArt ? 0.3 : 0} />
            </LinearGradient>
            <RadialGradient id="glow" cx="1" cy="0" rx="1.2" ry="1.4">
              <Stop offset="0" stopColor={accent.accentDim} stopOpacity={0.55} />
              <Stop offset="0.6" stopColor={accent.accentDim} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#glow)" />
          <Rect width="100%" height="100%" fill="url(#wash)" />
        </Svg>

        <View style={[styles.heroInner, wide ? styles.heroInnerWide : styles.heroInnerNarrow]}>
          <View style={wide ? styles.heroMainWide : undefined}>
            <Text style={styles.eyebrow}>{eyebrow(range).toUpperCase()}</Text>
            <Text style={[styles.figure, !wide && styles.figureNarrow]}>
              {figure(wrapped.totals.minutes)}
            </Text>
            <Text style={styles.figureUnit}>{figureUnit(wrapped.totals.minutes)}</Text>
            {wrapped.personality.traits.length > 0 ? (
              <View style={styles.traits} accessibilityLabel="Your listening traits">
                {wrapped.personality.traits.map(trait => (
                  <View
                    key={trait}
                    style={[
                      styles.trait,
                      { borderColor: accent.accentDim, backgroundColor: accent.accentWash },
                    ]}
                  >
                    <Sparkles size={13} color={accent.accent} />
                    <Text style={[styles.traitText, { color: accent.accent }]}>{trait}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>

          <View style={[styles.facts, wide && styles.heroMainWide]}>
            {facts(wrapped).map(fact => (
              <View
                key={fact.label}
                style={[styles.fact, wide ? styles.factWide : styles.factNarrow]}
              >
                <Text style={styles.factLabel}>{fact.label}</Text>
                <Text style={styles.factValue}>{fact.value}</Text>
                {fact.hint ? <Text style={styles.factHint}>{fact.hint}</Text> : null}
              </View>
            ))}
          </View>
        </View>
      </View>

      <View
        style={styles.chapters}
        onLayout={event => setGridWidth(event.nativeEvent.layout.width)}
      >
        <Chapter
          number="01"
          title="Top songs"
          width={chapterWidth}
          action={
            wrapped.topSongs.length > 0 ? (
              <Button
                label="Play all"
                icon={<Play size={13} color={theme.colors.textPrimary} />}
                onPress={() => playTop(wrapped.topSongs.map(song => song.songId))}
              />
            ) : null
          }
        >
          {topSong ? (
            <Pressable
              disabled={!topInLibrary}
              onPress={() => topInLibrary && player.playFrom([topInLibrary.id], 0)}
              accessibilityRole="button"
              accessibilityLabel={`Your number one: ${topSong.title}, ${topSong.artist || 'Unknown artist'}`}
              style={styles.numberOne}
            >
              {/* The web's wash: the accent's dim shade, fading out across the card. */}
              <Svg
                style={NativeStyleSheet.absoluteFill}
                width="100%"
                height="100%"
                pointerEvents="none"
              >
                <Defs>
                  <LinearGradient id="numberOne" x1="0" y1="0" x2="1" y2="0.2">
                    <Stop offset="0" stopColor={accent.accentDim} stopOpacity={0.55} />
                    <Stop offset="0.85" stopColor={accent.accentDim} stopOpacity={0} />
                  </LinearGradient>
                </Defs>
                <Rect width="100%" height="100%" fill="url(#numberOne)" />
              </Svg>
              <Cover uri={heroArt} title={topSong.title} size={92} />
              <View style={styles.numberOneText}>
                <Text style={[styles.numberOneLabel, { color: accent.accent }]}>
                  YOUR NUMBER ONE
                </Text>
                <Text
                  style={[styles.numberOneTitle, !wide && styles.numberOneTitleNarrow]}
                  numberOfLines={1}
                >
                  {topSong.title}
                </Text>
                <Text style={styles.numberOneArtist} numberOfLines={1}>
                  {topSong.artist || 'Unknown artist'}
                </Text>
                <Text style={styles.numberOnePlays}>{numberOneLine(topSong)}</Text>
              </View>
            </Pressable>
          ) : null}
          {wrapped.topSongs.slice(1).map((entry, index) => (
            <SongLine
              key={entry.songId}
              song={songById.get(entry.songId)}
              title={entry.title}
              artist={entry.artist}
              rank={index + 2}
              trailing={playsLabel(entry.plays)}
            />
          ))}
        </Chapter>

        <Chapter number="02" title="Top artists" width={chapterWidth}>
          <RankList entries={wrapped.topArtists} />
          {wrapped.topTags.length > 0 ? (
            <>
              <Text style={styles.subhead}>TOP TAGS</Text>
              <RankList entries={wrapped.topTags} />
            </>
          ) : null}
        </Chapter>

        {wrapped.mostInOneDay ? (
          <Chapter
            number="03"
            title="On repeat"
            width={chapterWidth}
            hint={longDate(wrapped.mostInOneDay.date)}
          >
            <Text style={[styles.repeatFigure, { color: accent.accent }]}>
              {wrapped.mostInOneDay.plays}
              <Text style={styles.repeatTimes}>×</Text>
            </Text>
            <Text style={styles.repeatSong}>
              <Text style={styles.strong}>{wrapped.mostInOneDay.title}</Text>
              <Text style={styles.hint}> — {wrapped.mostInOneDay.artist || 'Unknown artist'}</Text>
            </Text>
            <Text style={styles.hint}>{repeatNote(wrapped)}</Text>
          </Chapter>
        ) : null}

        <Chapter
          number={discoveredChapter(wrapped)}
          title="Discovered"
          width={chapterWidth}
          action={
            wrapped.discovered.length > 0 ? (
              <Button
                label="Play all"
                icon={<Play size={13} color={theme.colors.textPrimary} />}
                onPress={() => playTop(wrapped.discovered.map(song => song.songId))}
              />
            ) : null
          }
        >
          {wrapped.discovered.length === 0 ? (
            <Text style={styles.hint}>
              Nothing new stuck in this window — a song counts once you have added it and played it
              three times.
            </Text>
          ) : (
            <RankList
              entries={wrapped.discovered.slice(0, 8).map(song => ({
                key: song.title,
                sub: song.artist || 'Unknown artist',
                plays: song.plays,
              }))}
            />
          )}
        </Chapter>
      </View>
    </>,
  )
}

function Chapter({
  number,
  title,
  hint,
  action,
  width,
  children,
}: {
  number: string
  title: string
  hint?: string
  action?: ReactNode
  width?: number
  children: ReactNode
}): ReactNode {
  const accent = useAccent()
  return (
    <View style={[styles.chapter, width !== undefined ? { width } : styles.chapterFull]}>
      <View style={styles.chapterHead}>
        <View style={styles.chapterTitleRow}>
          <Text style={[styles.chapterNo, { color: accent.accent }]}>{number}</Text>
          <Text style={styles.chapterTitle} accessibilityRole="header">
            {title}
          </Text>
        </View>
        {action ?? (hint ? <Text style={styles.hint}>{hint}</Text> : null)}
      </View>
      {children}
    </View>
  )
}

/** A ranked list whose rows carry their share of the first as a quiet bar behind the name. */
function RankList({
  entries,
}: {
  entries: readonly { key: string; plays: number; sub?: string }[]
}): ReactNode {
  const accent = useAccent()
  if (entries.length === 0) return <Text style={styles.hint}>Nothing here yet</Text>
  const max = entries[0]?.plays ?? 1
  return (
    <View>
      {entries.map((entry, index) => (
        <View
          key={`${entry.key}-${index}`}
          style={styles.rankRow}
          accessible
          accessibilityLabel={`${index + 1}. ${entry.key}${entry.sub ? `, ${entry.sub}` : ''}: ${entry.plays}`}
        >
          <View style={[styles.rankBar, { width: `${rankShare(entry.plays, max)}%` }]} />
          <Text style={[styles.rank, { color: accent.accent }]}>{index + 1}</Text>
          <Text style={styles.rankName} numberOfLines={1}>
            {entry.key}
            {entry.sub ? <Text style={styles.hint}> — {entry.sub}</Text> : null}
          </Text>
          <Text style={styles.rankValue}>{entry.plays}</Text>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  content: { paddingBottom: 40 },
  contentWide: { paddingTop: 28, paddingHorizontal: 32 },
  contentNarrow: { paddingTop: 18, paddingHorizontal: 16 },
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    marginBottom: 20,
  },
  headNarrow: { flexDirection: 'column', gap: 12 },
  heading: { color: theme.colors.textPrimary, fontSize: 26, fontWeight: '700' },
  headingNarrow: { fontSize: 22 },
  sub: { color: theme.colors.textMuted, fontSize: 13, marginTop: 6 },
  link: { textDecorationLine: 'underline' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  actionsNarrow: { flexDirection: 'column', alignItems: 'flex-start' },
  hint: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 17 },
  strong: { color: theme.colors.textPrimary, fontWeight: '700' },
  center: { textAlign: 'center', maxWidth: 420 },
  notice: {
    marginBottom: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.danger,
    backgroundColor: theme.colors.surface1,
  },
  noticeText: { color: theme.colors.textPrimary, fontSize: 13 },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 8 },
  emoji: { fontSize: 36 },
  emptyActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
    marginTop: 8,
  },
  hero: {
    overflow: 'hidden',
    marginBottom: 18,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  heroArt: {
    position: 'absolute',
    top: '-12%',
    left: '-12%',
    width: '124%',
    height: '124%',
    opacity: 0.75,
  },
  heroInner: { gap: 24 },
  heroInnerWide: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 30,
    paddingHorizontal: 28,
  },
  heroInnerNarrow: { paddingVertical: 22, paddingHorizontal: 18, gap: 20 },
  heroMainWide: { flex: 1, minWidth: 240 },
  eyebrow: {
    color: theme.colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.1,
  },
  figure: {
    color: theme.colors.textPrimary,
    fontSize: 84,
    lineHeight: 88,
    fontWeight: '700',
    letterSpacing: -3,
    marginTop: 6,
  },
  figureNarrow: { fontSize: 56, lineHeight: 60, letterSpacing: -2 },
  figureUnit: { color: theme.colors.textSecondary, fontSize: 14, marginTop: 2 },
  traits: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 16 },
  trait: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingLeft: 9,
    paddingRight: 11,
    borderRadius: 999,
    borderWidth: 1,
  },
  traitText: { fontSize: 12, fontWeight: '600' },
  facts: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 14 },
  fact: { paddingRight: 12 },
  factWide: { width: '33.3%' },
  factNarrow: { width: '50%' },
  factLabel: { color: theme.colors.textMuted, fontSize: 11, marginBottom: 2 },
  factValue: { color: theme.colors.textPrimary, fontSize: 19, fontWeight: '700' },
  factHint: { color: theme.colors.textMuted, fontSize: 11 },
  chapters: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: GAP },
  chapter: {
    padding: 18,
    gap: 10,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: radius.md,
  },
  chapterFull: { width: '100%' },
  chapterHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  chapterTitleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 9 },
  chapterNo: { fontSize: 11, fontWeight: '700', letterSpacing: 0.9, fontVariant: ['tabular-nums'] },
  chapterTitle: { color: theme.colors.textPrimary, fontSize: 15, fontWeight: '600' },
  numberOne: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 12,
    marginBottom: 4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: 'hidden',
  },
  numberOneText: { flex: 1, minWidth: 0, gap: 1 },
  numberOneLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.9, marginBottom: 3 },
  numberOneTitle: { color: theme.colors.textPrimary, fontSize: 19, fontWeight: '700' },
  numberOneTitleNarrow: { fontSize: 17 },
  numberOneArtist: { color: theme.colors.textSecondary, fontSize: 13 },
  numberOnePlays: { color: theme.colors.textMuted, fontSize: 11, marginTop: 3 },
  subhead: { color: theme.colors.textMuted, fontSize: 11, letterSpacing: 0.9, marginTop: 8 },
  rankRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
    paddingVertical: 8,
    paddingLeft: 6,
    paddingRight: 8,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  rankBar: {
    position: 'absolute',
    left: 0,
    top: 2,
    bottom: 2,
    borderRadius: radius.sm,
    backgroundColor: withAlpha(theme.colors.chartSeries, 0.22),
  },
  rank: { width: 16, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  rankName: { flex: 1, minWidth: 0, color: theme.colors.textPrimary, fontSize: 13 },
  rankValue: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  repeatFigure: { fontSize: 52, lineHeight: 56, fontWeight: '700', letterSpacing: -1.5 },
  repeatTimes: { fontSize: 26, color: theme.colors.textSecondary },
  repeatSong: { fontSize: 15, color: theme.colors.textPrimary },
}))
