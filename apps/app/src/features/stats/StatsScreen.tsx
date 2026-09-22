import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import Svg, { Path } from 'react-native-svg'
import type { Song, Stats } from '@selfmp3/shared'
import { radius, tagColors, useLibrary, type ServerConnection } from '@selfmp3/client'
import { useContentWidth } from '../../shell/contentWidth'
import { useLayout } from '../../shell/useLayout'
import { useArt } from '../../offline/useArt'
import { Cover } from '../../ui/components/Cover'
import { User } from '../../ui/components/Icons'
import { Segmented } from '../../ui/components/Segmented'
import { card, label, serif } from '../../ui/surfaces'
import { songLink } from '../song/song.model'
import { artistLink, tagLink } from '../tag/placeLinks'
import { StatsFrame } from './StatsFrame'
import { useStatsFor, useStatsSongs } from './statsSource'
import {
  listenedCard,
  peakCard,
  RANK_KINDS,
  rankedEmpty,
  rankedRows,
  sparkPath,
  statsRangeFor,
  streakCard,
  type RankedRow,
  type RankKind,
  type StatsPeriod,
} from './stats.model'

/** The line beside Listened, in its own box's units. */
const SPARK = { width: 120, height: 56 }

/** The page column's width from which the three lists fit side by side. */
const THREE_LISTS = 860

/**
 * Stats (`P32`, `C15`): Listened, Peak hour and Streak as cards, each one big
 * number with a small picture of where it came from, then one ranked module of
 * what was played most. The month told as a page is the Report's, one link away.
 *
 * `via` is a server reached directly from a cloud library (StatsViaServer): the
 * numbers are then its, and the songs they name are lined up with this
 * device's (statsSource.ts).
 */
export function StatsScreen({ via }: { via?: ServerConnection } = {}): ReactNode {
  const [period, setPeriod] = useState<StatsPeriod>('month')
  const { data: stats, isLoading } = useStatsFor(via, statsRangeFor(period))

  return (
    <StatsFrame period={period} onPeriod={setPeriod} testID="stats-screen">
      {isLoading && !stats ? (
        <Text style={styles.hint}>Working it out…</Text>
      ) : !stats ? (
        <Empty
          title="Stats need your library"
          hint="They’ll be here when your server is reachable again."
        />
      ) : stats.totals.plays === 0 ? (
        <Empty
          title="Nothing to show yet"
          hint="Play some music and this fills in — how long, when, and what most."
        />
      ) : (
        <>
          <Cards stats={stats} />
          <Ranked stats={stats} via={via} />
        </>
      )}
    </StatsFrame>
  )
}

/**
 * The three cards. A computer lays them in one row, Listened twice as wide; a
 * phone gives Listened the width and puts the other two side by side under it.
 */
function Cards({ stats }: { stats: Stats }): ReactNode {
  const { wide } = useLayout()
  const listened = useMemo(() => listenedCard(stats), [stats])
  const peak = useMemo(() => peakCard(stats.hourly), [stats])
  // Today is read once per answer: the dots move on when the numbers do.
  const streak = useMemo(() => streakCard(stats, new Date()), [stats])

  const listenedView = (
    <View style={[styles.card, styles.listened, wide && styles.cardWide]} testID="stats-listened">
      <View style={styles.listenedWords}>
        <Text style={styles.cardLabel}>Listened</Text>
        <Text style={[styles.bigNumber, wide && styles.bigNumberWide]} numberOfLines={1}>
          {listened.value}
        </Text>
        <Text style={styles.cardLine}>{listened.line}</Text>
      </View>
      <Spark values={listened.trend} />
    </View>
  )

  const peakView = (
    <View
      style={[styles.card, styles.small, wide && styles.cardWide]}
      accessible
      accessibilityLabel={
        peak.value ? `Peak hour: ${peak.value}, ${peak.words}` : 'Peak hour: no plays yet'
      }
      testID="stats-peak"
    >
      <Text style={styles.cardLabel}>Peak hour</Text>
      <View style={[styles.hours, wide && styles.hoursWide]}>
        {peak.bars.map((share, hour) => (
          <View
            key={hour}
            style={[
              styles.hour,
              { height: `${Math.max(4, share * 100)}%` },
              hour === peak.peak && styles.hourPeak,
            ]}
          />
        ))}
      </View>
      <View style={styles.cardFoot}>
        <Text style={styles.midNumber}>{peak.value ?? '—'}</Text>
        {peak.words ? <Text style={styles.cardNote}>{peak.words}</Text> : null}
      </View>
    </View>
  )

  const streakView = (
    <View
      style={[styles.card, styles.small, wide && styles.cardWide]}
      accessible
      accessibilityLabel={`Streak: ${streak.value}${streak.line ? `, ${streak.line}` : ''}`}
      testID="stats-streak"
    >
      <Text style={styles.cardLabel}>Streak</Text>
      <View style={styles.dots}>
        {streak.dots.map(dot => (
          <View
            key={dot.date}
            style={[
              styles.dot,
              dot.played && styles.dotPlayed,
              // Today is white whichever it is: where the run stands now.
              dot.today && styles.dotToday,
            ]}
          />
        ))}
      </View>
      <View style={styles.cardFoot}>
        <Text style={styles.midNumber}>{streak.value}</Text>
        {streak.line ? <Text style={styles.cardNote}>{streak.line}</Text> : null}
      </View>
    </View>
  )

  if (wide) {
    return (
      <View style={styles.cardRow}>
        <View style={styles.twoCols}>{listenedView}</View>
        <View style={styles.oneCol}>{peakView}</View>
        <View style={styles.oneCol}>{streakView}</View>
      </View>
    )
  }
  return (
    <>
      {listenedView}
      <View style={styles.cardRow}>
        <View style={styles.oneCol}>{peakView}</View>
        <View style={styles.oneCol}>{streakView}</View>
      </View>
    </>
  )
}

/** Minutes per day as one accent stroke. Decoration beside the number, so unread. */
function Spark({ values }: { values: readonly number[] }): ReactNode {
  const { theme } = useUnistyles()
  if (values.length < 2) return null
  return (
    <View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={SPARK.width} height={SPARK.height} viewBox={`0 0 ${SPARK.width} ${SPARK.height}`}>
        <Path
          d={sparkPath(values, SPARK.width, SPARK.height)}
          fill="none"
          stroke={theme.colors.accent}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  )
}

/**
 * What was played most: Songs, Artists and Tags. A phone shows one at a time
 * and switches between them; a computer with the width for all three puts them
 * side by side, as `C15` draws them. The page column is measured rather than
 * the window, since the sidebar and the practice panel take their share of it.
 */
function Ranked({ stats, via }: { stats: Stats; via: ServerConnection | undefined }): ReactNode {
  const column = useContentWidth()
  const [kind, setKind] = useState<RankKind>('songs')

  if (column !== null && column >= THREE_LISTS) {
    return (
      <View style={[styles.card, styles.rankedWide]} testID="stats-ranked">
        {RANK_KINDS.map(option => (
          <View key={option.value} style={styles.rankedColumn}>
            <Text style={styles.columnLabel} accessibilityRole="header">
              {option.label}
            </Text>
            <RankedList stats={stats} kind={option.value} via={via} />
          </View>
        ))}
      </View>
    )
  }
  return (
    <View style={[styles.card, styles.ranked]} testID="stats-ranked">
      <Segmented value={kind} onChange={setKind} label="Most played" options={RANK_KINDS} />
      <RankedList stats={stats} kind={kind} via={via} />
    </View>
  )
}

function RankedList({
  stats,
  kind,
  via,
}: {
  stats: Stats
  kind: RankKind
  via: ServerConnection | undefined
}): ReactNode {
  const rows = useMemo(() => rankedRows(stats, kind), [stats, kind])
  const songFor = useStatsSongs(via)
  const { data: library } = useLibrary()
  const hueOf = useMemo(
    () => new Map((library?.tags ?? []).map(tag => [tag.name, tag.hue])),
    [library],
  )
  if (rows.length === 0) return <Text style={styles.listEmpty}>{rankedEmpty(kind)}</Text>
  return (
    <View>
      {rows.map((row, index) => (
        <RankedLine
          key={row.key}
          row={row}
          song={row.kind === 'song' ? songFor(row.songId) : undefined}
          hue={row.kind === 'tag' ? hueOf.get(row.name) : undefined}
          testID={`stats-ranked-${kind}-${index}`}
        />
      ))}
    </View>
  )
}

/**
 * One place in the ranking: its number in the serif, a picture, the name and
 * how much, and a bar under the name. The first bar is the accent; the rest
 * are quieter, so the eye reads the list as "the first, and then the others".
 *
 * Each opens its page: a song its own page, an artist or a tag the place. A
 * song this device cannot line up with the server's, and a song with no
 * artist, open nothing.
 */
function RankedLine({
  row,
  song,
  hue,
  testID,
}: {
  row: RankedRow
  song: Song | undefined
  hue: number | undefined
  testID: string
}): ReactNode {
  const router = useRouter()
  const artFor = useArt()
  const { theme } = useUnistyles()

  const open =
    row.kind === 'song'
      ? song
        ? () => router.navigate(songLink(song.id))
        : undefined
      : row.kind === 'artist'
        ? row.known
          ? () => router.navigate(artistLink(row.name))
          : undefined
        : () => router.navigate(tagLink(row.name))

  const picture =
    row.kind === 'song' ? (
      <Cover uri={song ? artFor(song) : null} title={row.name} size={36} />
    ) : row.kind === 'artist' ? (
      <View style={styles.artistFigure}>
        <User size={17} tone="textPrimary" />
      </View>
    ) : (
      <View style={styles.tagSquare}>
        <View
          style={[
            styles.tagDot,
            { backgroundColor: hue === undefined ? theme.colors.textMuted : tagColors(hue).dot },
          ]}
        />
      </View>
    )

  return (
    <Pressable
      disabled={!open}
      onPress={open}
      accessibilityRole={open ? 'link' : undefined}
      accessibilityLabel={`${row.rank}. ${row.name}${
        row.kind === 'song' && row.artist ? `, ${row.artist}` : ''
      }, ${row.trailing}`}
      testID={testID}
      style={({ pressed }) => [styles.line, pressed && styles.linePressed]}
    >
      <Text style={styles.rank}>{row.rank}</Text>
      {picture}
      <View style={styles.lineBody}>
        <View style={styles.lineTop}>
          <Text style={styles.lineName} numberOfLines={1}>
            {row.name}
          </Text>
          <Text style={styles.lineTrailing} numberOfLines={1}>
            {row.trailing}
          </Text>
        </View>
        <View style={styles.track}>
          <View
            style={[
              styles.fill,
              row.rank === 1 && styles.fillFirst,
              { width: `${Math.max(2, row.share * 100)}%` },
            ]}
          />
        </View>
      </View>
    </Pressable>
  )
}

function Empty({ title, hint }: { title: string; hint: string }): ReactNode {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={[styles.hint, styles.emptyHint]}>{hint}</Text>
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  hint: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 17 },
  // A big card on the ground (`S2`: 22 round), told apart by tone, not an edge.
  card: { ...card(theme.colors, radius.cardLg), padding: 18 },
  cardWide: { height: 190, paddingHorizontal: 20 },
  cardRow: { flexDirection: 'row', gap: 12 },
  twoCols: { flex: 2, minWidth: 0 },
  oneCol: { flex: 1, minWidth: 0 },
  listened: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
  },
  // The words take the card's room before the spark does: squeezed, the number
  // was ellipsised to "2…", which is not a number.
  listenedWords: { gap: 4, flex: 1, minWidth: 0 },
  cardLabel: label(theme.colors),
  // Big numbers are the serif, which has one weight (`S2`).
  /*
   * The serif's figures stand taller than their own line, so a line box the
   * size of the type cut the top off "20". A fifth again is room for the ink.
   */
  bigNumber: { ...serif(theme.colors, 52), lineHeight: 62 },
  bigNumberWide: { fontSize: 60, lineHeight: 72 },
  cardLine: { color: theme.colors.textSecondary, fontSize: 13 },
  small: { height: 150, padding: 16, justifyContent: 'space-between' },
  hours: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 44 },
  hoursWide: { height: 60 },
  // An hour with plays is the raised tone; the busiest is the accent.
  hour: { flex: 1, borderRadius: 2, backgroundColor: theme.colors.surface3 },
  hourPeak: { backgroundColor: theme.colors.accent },
  dots: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.colors.surface3 },
  dotPlayed: { backgroundColor: theme.colors.accent },
  dotToday: { backgroundColor: theme.colors.textPrimary },
  cardFoot: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 8 },
  midNumber: { ...serif(theme.colors, 28), lineHeight: 30 },
  cardNote: { color: theme.colors.textSecondary, fontSize: 12 },
  ranked: { paddingTop: 14, paddingBottom: 8, paddingHorizontal: 16, gap: 8 },
  rankedWide: { flexDirection: 'row', gap: 36, paddingVertical: 18, paddingHorizontal: 22 },
  rankedColumn: { flex: 1, minWidth: 0, gap: 4 },
  columnLabel: { ...label(theme.colors), paddingBottom: 4 },
  listEmpty: { color: theme.colors.textMuted, fontSize: 13, paddingVertical: 14 },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    borderRadius: radius.cover,
  },
  linePressed: { opacity: 0.7 },
  rank: { ...serif(theme.colors, 18), width: 18, color: theme.colors.textMuted },
  artistFigure: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceSelected,
  },
  tagSquare: {
    width: 36,
    height: 36,
    borderRadius: radius.cover,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface3,
  },
  tagDot: { width: 10, height: 10, borderRadius: 5 },
  lineBody: { flex: 1, minWidth: 0, gap: 5 },
  lineTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  // The name takes what is left and ellipsises; the figure beside it never
  // gives up room, or a long title squeezes "3 plays" down to "3" and then
  // past the column's edge (Xiao, 2026-09-21).
  lineName: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  lineTrailing: { flexShrink: 0, color: theme.colors.textSecondary, fontSize: 12 },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.surface3,
    overflow: 'hidden',
  },
  fill: { height: 4, borderRadius: 2, backgroundColor: theme.colors.textMuted },
  fillFirst: { backgroundColor: theme.colors.accent },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 8 },
  emptyTitle: { color: theme.colors.textPrimary, fontSize: 15, fontWeight: '600' },
  emptyHint: { textAlign: 'center', maxWidth: 360 },
}))
