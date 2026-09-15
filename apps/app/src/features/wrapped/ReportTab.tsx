import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet as NativeStyleSheet,
  Text,
  View,
} from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg'
import type { Song } from '@selfmp3/shared'
import { radius, withAlpha, useLibrary, useWrapped } from '@selfmp3/client'
import { useArt } from '../../offline/useArt'
import { usePlayer } from '../../player/PlayerProvider'
import { canShareCard, shareWrappedCard } from '../../ports/shareCard'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../../ui/accent'
import { useBackTo } from '../../ui/components/BackRow'
import { Button } from '../../ui/components/Button'
import { Cover } from '../../ui/components/Cover'
import { IconButton } from '../../ui/components/IconButton'
import { Download, Play, Sparkles } from '../../ui/components/Icons'
import { SongLine } from '../stats/SongLine'
import { StatsFrame, type StatsFrameProps } from '../stats/StatsFrame'
import { longDate, periodOfWrapped, playsLabel, wrappedRangeFor } from '../stats/stats.model'
import {
  DISCOVERED_SHOWN,
  discoveredChapter,
  emptyHint,
  emptyTitle,
  eyebrow,
  facts,
  figure,
  figureUnit,
  longerRanges,
  numberOneLine,
  rankShare,
  repeatNote,
  showDiscovered,
  tryLabel,
} from './wrapped.model'

const GAP = 14
const CHAPTER_MIN = 330

/**
 * Stats' Report tab, a listening report for any window.
 *
 * The one screen allowed to be a bit of a show: the figure set large, the top
 * song's cover beside it, each section a numbered chapter. It keeps the app's
 * type scale, spacing and accent, so it reads as the same app in its good coat.
 *
 * The window is the Stats page's (StatsFrame), and so is the header: sharing
 * the report as an image is an icon in its corner.
 */
export function ReportTab(frame: StatsFrameProps): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const backTo = useBackTo()
  const player = usePlayer()
  const artFor = useArt()
  const { wide } = useLayout()
  const range = wrappedRangeFor(frame.period)
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

  // Only where an image can be made and handed on: a browser and the Mac app.
  const shareButton = canShareCard ? (
    <IconButton
      label={sharing ? 'Making the image…' : 'Share as image'}
      disabled={!wrapped || wrapped.totals.plays === 0 || sharing}
      onPress={() => void share()}
    >
      {sharing ? (
        <ActivityIndicator size="small" color={theme.colors.textMuted} />
      ) : (
        <Download size={18} color={theme.colors.textSecondary} />
      )}
    </IconButton>
  ) : null

  const shell = (children: ReactNode): ReactNode => (
    <StatsFrame {...frame} actions={shareButton} testID="wrapped-screen">
      {children}
    </StatsFrame>
  )

  if (isLoading && !wrapped) return shell(<Text style={styles.hint}>Working it out…</Text>)

  if (!wrapped) {
    return shell(
      <View style={styles.empty}>
        <Text style={styles.chapterTitle}>The report needs your library</Text>
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
            <Button
              key={option}
              label={tryLabel(option)}
              onPress={() => frame.onPeriod(periodOfWrapped(option))}
            />
          ))}
          <Button
            label="Go to the library"
            variant="primary"
            icon={<Play size={15} color={accent.onAccent} />}
            onPress={() => backTo('/')}
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

      {/*
        The hero: the figure, the facts and the number one, each on solid ground.
        The cover used to be blurred behind all of it; a pale cover under a green
        accent left the labels and the trait chips unreadable. Now the cover is
        drawn sharp in a column of its own, and the accent appears only in marks
        that carry no text — a rule under the figure, the sparkle in a chip.
      */}
      <View style={styles.hero}>
        <Svg style={NativeStyleSheet.absoluteFill} width="100%" height="100%" pointerEvents="none">
          <Defs>
            <RadialGradient id="glow" cx="0" cy="0" rx="0.7" ry="1.3">
              <Stop offset="0" stopColor={accent.accentDim} stopOpacity={0.3} />
              <Stop offset="1" stopColor={accent.accentDim} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#glow)" />
        </Svg>

        <View style={wide ? styles.heroWide : undefined}>
          {/* On a phone the number one leads, a row across the top. */}
          {!wide && topSong ? (
            <NumberOne
              song={topSong}
              inLibrary={topInLibrary}
              art={heroArt}
              onPlay={() => topInLibrary && player.playFrom([topInLibrary.id], 0)}
            />
          ) : null}

          <View style={[styles.heroMain, wide ? styles.heroMainWide : styles.heroMainNarrow]}>
            <Text style={styles.eyebrow}>{eyebrow(range).toUpperCase()}</Text>
            <Text style={[styles.figure, !wide && styles.figureNarrow]}>
              {figure(wrapped.totals.minutes)}
            </Text>
            <View style={[styles.rule, { backgroundColor: accent.accent }]} />
            <Text style={styles.figureUnit}>{figureUnit(wrapped.totals.minutes)}</Text>
            {wrapped.personality.traits.length > 0 ? (
              <View style={styles.traits} accessibilityLabel="Your listening traits">
                {wrapped.personality.traits.map(trait => (
                  <View key={trait} style={styles.trait}>
                    <Sparkles size={13} color={accent.accent} />
                    <Text style={styles.traitText}>{trait}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>

          <View style={[styles.facts, wide ? styles.factsWide : styles.factsNarrow]}>
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

          {wide && topSong ? (
            <NumberOne
              song={topSong}
              inLibrary={topInLibrary}
              art={heroArt}
              wide
              onPlay={() => topInLibrary && player.playFrom([topInLibrary.id], 0)}
            />
          ) : null}
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
          {/* The number one has its place in the hero; here it heads the list like the rest. */}
          {wrapped.topSongs.map((entry, index) => (
            <SongLine
              key={entry.songId}
              song={songById.get(entry.songId)}
              title={entry.title}
              artist={entry.artist}
              rank={index + 1}
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

        {showDiscovered(wrapped) ? (
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
                Nothing new stuck in this window — a song counts once you have added it and played
                it three times.
              </Text>
            ) : (
              <RankList
                entries={wrapped.discovered.slice(0, DISCOVERED_SHOWN).map(song => ({
                  key: song.title,
                  sub: song.artist || 'Unknown artist',
                  plays: song.plays,
                }))}
              />
            )}
          </Chapter>
        ) : null}
      </View>
    </>,
  )
}

/**
 * The most-played song, with its cover drawn sharp: a column at the end of the
 * hero on a computer, a row across its top on a phone. Pressing it plays it.
 */
function NumberOne({
  song,
  inLibrary,
  art,
  wide = false,
  onPlay,
}: {
  song: { title: string; artist: string; plays: number; minutes: number }
  inLibrary: Song | undefined
  art: string | null
  wide?: boolean
  onPlay: () => void
}): ReactNode {
  const accent = useAccent()
  return (
    <Pressable
      disabled={!inLibrary}
      onPress={onPlay}
      accessibilityRole="button"
      accessibilityLabel={`Your number one: ${song.title}, ${song.artist || 'Unknown artist'}`}
      style={({ pressed }) => [
        wide ? styles.numberOneWide : styles.numberOneNarrow,
        pressed && { opacity: 0.8 },
      ]}
    >
      <Cover uri={art} title={song.title} size={wide ? 176 : 56} />
      <View style={styles.numberOneText}>
        <Text style={[styles.numberOneLabel, { color: accent.accent }]}>YOUR NUMBER ONE</Text>
        <Text style={[styles.numberOneTitle, !wide && styles.numberOneTitleNarrow]} numberOfLines={1}>
          {song.title}
        </Text>
        <Text style={styles.numberOnePlays} numberOfLines={2}>
          {song.artist || 'Unknown artist'} · {numberOneLine(song)}
        </Text>
      </View>
    </Pressable>
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
  heroWide: { flexDirection: 'row', alignItems: 'stretch' },
  heroMain: { justifyContent: 'center' },
  heroMainWide: { flex: 1, minWidth: 240, paddingVertical: 28, paddingHorizontal: 28 },
  heroMainNarrow: { paddingTop: 20, paddingHorizontal: 18, paddingBottom: 18 },
  /* A short rule in the accent under the figure: the accent, with no text on it. */
  rule: { width: 64, height: 4, borderRadius: 2, marginTop: 10, marginBottom: 6 },
  factsWide: {
    flex: 1,
    minWidth: 260,
    justifyContent: 'center',
    paddingVertical: 28,
    paddingHorizontal: 24,
    borderLeftWidth: 1,
    borderLeftColor: theme.colors.border,
  },
  factsNarrow: { paddingHorizontal: 18, paddingBottom: 22 },
  numberOneWide: {
    width: 212,
    padding: 18,
    gap: 10,
    justifyContent: 'center',
    borderLeftWidth: 1,
    borderLeftColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  numberOneNarrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
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
  figureUnit: { color: theme.colors.textSecondary, fontSize: 14 },
  traits: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 16 },
  /* Neutral, so a chip never has to sit on its own colour. The sparkle carries the accent. */
  trait: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingLeft: 9,
    paddingRight: 11,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
  },
  traitText: { fontSize: 12, fontWeight: '600', color: theme.colors.textPrimary },
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
  numberOneText: { flex: 1, minWidth: 0, gap: 1 },
  numberOneLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.9, marginBottom: 3 },
  numberOneTitle: { color: theme.colors.textPrimary, fontSize: 16, fontWeight: '700' },
  numberOneTitleNarrow: { fontSize: 15 },
  numberOnePlays: { color: theme.colors.textMuted, fontSize: 11, marginTop: 2 },
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
