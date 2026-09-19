import type { HourlyPlays, Stats, StatsRange, TopEntry, TopSong } from '@selfmp3/shared'
import { artistKey, splitArtists } from '@selfmp3/client'

/**
 * Listening stats, without the screen.
 *
 * Everything on the page is derived from stored play events, so the questions
 * can change later without the data having been thrown away. The page is a few
 * cards, each one number with a small picture of where it came from (`P32`,
 * `C15`), then one ranked module of what was played most.
 */

/** The window the page shows. */
export type StatsPeriod = 'week' | 'month' | 'quarter' | 'year' | 'all'

export const STATS_PERIODS: readonly StatsPeriod[] = ['week', 'month', 'quarter', 'year', 'all']

const PERIOD_LABELS: Record<StatsPeriod, string> = {
  week: 'Week',
  month: 'Month',
  quarter: '3 months',
  year: 'Year',
  all: 'All time',
}

export function periodLabel(period: StatsPeriod): string {
  return PERIOD_LABELS[period]
}

const STATS_RANGE_OF: Record<StatsPeriod, StatsRange> = {
  week: '7d',
  month: '30d',
  quarter: '90d',
  year: '365d',
  all: 'all',
}

/** The window as the stats endpoint names it. */
export function statsRangeFor(period: StatsPeriod): StatsRange {
  return STATS_RANGE_OF[period]
}

/** A local date as the server writes one: `2026-09-14`. */
function isoDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function daysBefore(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - days)
}

/** 0 → "12am", 13 → "1pm". */
export function formatHour(hour: number): string {
  if (hour === 0) return '12am'
  if (hour === 12) return '12pm'
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`
}

/** The busiest hour, or nothing when no hour has a play. */
export function peakHour(hourly: readonly HourlyPlays[]): HourlyPlays | null {
  if (hourly.length === 0) return null
  const best = hourly.reduce((a, b) => (b.plays > a.plays ? b : a))
  return best.plays > 0 ? best : null
}

/**
 * What the busiest hour says about you, under Peak hour: the same bands the
 * Report's "Night owl" and "Early bird" use (`packages/shared/src/personality.ts`),
 * so the two pages never disagree about when night starts.
 */
export function peakHourWords(hour: number): string {
  if (hour >= 22 || hour <= 4) return 'Night owl'
  if (hour <= 9) return 'Early bird'
  if (hour <= 17) return 'Daytime listener'
  return 'Evening listener'
}

const plural = (count: number, one: string, many: string): string =>
  `${count.toLocaleString()} ${count === 1 ? one : many}`

export function daysLabel(days: number): string {
  return plural(days, 'day', 'days')
}

export function playsLabel(plays: number): string {
  return plural(plays, 'play', 'plays')
}

/** "best: 4 days" ("best: 1 day"), once there has been a streak at all. */
export function bestStreakHint(longest: number): string | undefined {
  return longest > 0 ? `best: ${daysLabel(longest)}` : undefined
}

/**
 * Time listened, short enough to be a big number: "6h 12", "3h", "42 min".
 * The minutes after the hours carry no unit, as a clock's do (`P32`).
 */
export function durationWords(minutes: number): string {
  const total = Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0
  if (total < 60) return `${total} min`
  const hours = Math.floor(total / 60)
  const rest = total % 60
  return rest === 0 ? `${hours}h` : `${hours}h ${String(rest).padStart(2, '0')}`
}

// ------------------------------------------------------------------ the cards

interface ListenedCard {
  readonly value: string
  /** "128 plays · 22 days with music". */
  readonly line: string
  /** Minutes per day, oldest first, for the line beside the number. */
  readonly trend: readonly number[]
}

/**
 * Listened. The board compares with the month before ("40 min more than
 * August"); the stats endpoint answers one window at a time, so the line says
 * what this window holds instead of inventing a comparison.
 */
export function listenedCard(stats: Stats): ListenedCard {
  const active = stats.daily.filter(day => day.plays > 0).length
  return {
    value: durationWords(stats.totals.minutes),
    line: `${playsLabel(stats.totals.plays)} · ${plural(active, 'day', 'days')} with music`,
    trend: stats.daily.map(day => day.minutes),
  }
}

interface PeakCard {
  /** "11pm", or null with no play in the window. */
  readonly value: string | null
  readonly words: string | null
  /** Each hour's share of the busiest, 0 to 1, midnight first; `peak` is lit. */
  readonly bars: readonly number[]
  readonly peak: number | null
}

export function peakCard(hourly: readonly HourlyPlays[]): PeakCard {
  const peak = peakHour(hourly)
  const most = Math.max(1, ...hourly.map(hour => hour.plays))
  const byHour = Array.from({ length: 24 }, (_, hour) => {
    const found = hourly.find(entry => entry.hour === hour)
    return (found?.plays ?? 0) / most
  })
  return {
    value: peak ? formatHour(peak.hour) : null,
    words: peak ? peakHourWords(peak.hour) : null,
    bars: byHour,
    peak: peak?.hour ?? null,
  }
}

interface StreakDot {
  readonly date: string
  readonly played: boolean
  readonly today: boolean
}

interface StreakCard {
  readonly value: string
  /** "Sep 6 to 14", or the best run when there is no run now. */
  readonly line: string | undefined
  /** The window's days, up to the last thirty, oldest first. */
  readonly dots: readonly StreakDot[]
}

/**
 * The most days the dots under Streak cover: a month. A week's window has
 * seven, since the days before it were not asked about and would read as
 * days without music.
 */
const STREAK_DOTS = 30

/**
 * Streak: the run of days with music that is still going, and the month of
 * days it sits in.
 *
 * The server counts a run as still going when its last day is today or
 * yesterday (you might still put something on this evening), so the run's
 * last day is whichever of the two had a play.
 */
export function streakCard(
  stats: Pick<Stats, 'range' | 'daily' | 'streakDays' | 'longestStreakDays'>,
  today: Date,
): StreakCard {
  const played = new Set(stats.daily.filter(day => day.plays > 0).map(day => day.date))
  const todayIso = isoDay(today)
  // All time lists only the days with plays; every other window has a day for each day.
  const count = stats.range === 'all' ? STREAK_DOTS : Math.min(STREAK_DOTS, stats.daily.length)
  const dots = Array.from({ length: count }, (_, index) => {
    const date = isoDay(daysBefore(today, count - 1 - index))
    return { date, played: played.has(date), today: date === todayIso }
  })
  if (stats.streakDays === 0) {
    return { value: daysLabel(0), line: bestStreakHint(stats.longestStreakDays), dots }
  }
  const end = played.has(todayIso) ? today : daysBefore(today, 1)
  const start = daysBefore(end, stats.streakDays - 1)
  return { value: daysLabel(stats.streakDays), line: spanWords(start, end), dots }
}

/** "Sep 6 to 14", "Aug 30 to Sep 3", or one day alone: "Sep 14". */
export function spanWords(start: Date, end: Date): string {
  const month = (date: Date): string => date.toLocaleDateString(undefined, { month: 'short' })
  if (isoDay(start) === isoDay(end)) return `${month(end)} ${end.getDate()}`
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()
  return `${month(start)} ${start.getDate()} to ${sameMonth ? '' : `${month(end)} `}${end.getDate()}`
}

/**
 * The line beside Listened: minutes per day as one stroke, scaled to fill the
 * box. A single day, or none, is a flat line through the middle.
 */
export function sparkPath(values: readonly number[], width: number, height: number): string {
  const pad = 3
  if (values.length < 2) return `M${pad} ${height / 2} L${width - pad} ${height / 2}`
  const most = Math.max(...values)
  const least = Math.min(...values)
  const spread = most - least || 1
  const step = (width - pad * 2) / (values.length - 1)
  return values
    .map((value, index) => {
      const x = pad + index * step
      const y = height - pad - ((value - least) / spread) * (height - pad * 2)
      return `${index === 0 ? 'M' : 'L'}${round(x)} ${round(y)}`
    })
    .join(' ')
}

const round = (value: number): number => Math.round(value * 10) / 10

// ------------------------------------------------------- the ranked module

/** The three things the ranked module ranks, one at a time on a phone. */
export type RankKind = 'songs' | 'artists' | 'tags'

export const RANK_KINDS: readonly { value: RankKind; label: string }[] = [
  { value: 'songs', label: 'Songs' },
  { value: 'artists', label: 'Artists' },
  { value: 'tags', label: 'Tags' },
]

/** How many places each list has: what fits beside the cards without scrolling far. */
const RANKED_ROWS = 5

interface RankedBase {
  readonly key: string
  /** 1 for the most played. */
  readonly rank: number
  readonly name: string
  /** "14 plays" on the first line, the number alone below it, as a table repeats no unit. */
  readonly trailing: string
  /** The bar under the name: this row's share of the first row's, 0 to 1. */
  readonly share: number
}

export type RankedRow =
  | (RankedBase & { readonly kind: 'song'; readonly songId: number; readonly artist: string })
  | (RankedBase & { readonly kind: 'artist'; readonly known: boolean })
  | (RankedBase & { readonly kind: 'tag' })

/** What the server calls a song with no artist; it is not a place to open. */
const UNKNOWN_ARTIST = 'Unknown artist'

/** Songs by plays, as the server ranks them. */
export function rankedSongs(top: readonly TopSong[], limit = RANKED_ROWS): RankedRow[] {
  const rows = top.slice(0, limit)
  const most = Math.max(1, rows[0]?.plays ?? 0)
  return rows.map((song, index) => ({
    kind: 'song',
    key: `song-${song.songId}`,
    rank: index + 1,
    name: song.title,
    artist: song.artist,
    songId: song.songId,
    trailing: index === 0 ? playsLabel(song.plays) : song.plays.toLocaleString(),
    share: song.plays / most,
  }))
}

/**
 * Artists by time listened.
 *
 * The server groups plays by the artist string as written, so "ヨルシカ feat.
 * suis" is one line of its own. Artists here are split the way the rest of the
 * app splits them (Open question 3): a collaboration counts for everyone it
 * names, and two spellings that differ only in case are one artist.
 */
export function rankedArtists(top: readonly TopEntry[], limit = RANKED_ROWS): RankedRow[] {
  const folded = new Map<string, { name: string; minutes: number; plays: number }>()
  for (const entry of top) {
    const names = entry.key === UNKNOWN_ARTIST ? [entry.key] : splitArtists(entry.key)
    for (const name of names) {
      const key = artistKey(name)
      const had = folded.get(key)
      if (had) {
        had.minutes += entry.minutes
        had.plays += entry.plays
      } else folded.set(key, { name, minutes: entry.minutes, plays: entry.plays })
    }
  }
  const rows = [...folded.values()]
    .sort((a, b) => b.minutes - a.minutes || b.plays - a.plays || a.name.localeCompare(b.name))
    .slice(0, limit)
  const most = Math.max(1, rows[0]?.minutes ?? 0)
  return rows.map((artist, index) => ({
    kind: 'artist',
    key: `artist-${artistKey(artist.name)}`,
    rank: index + 1,
    name: artist.name,
    known: artist.name !== UNKNOWN_ARTIST,
    trailing: durationWords(artist.minutes),
    share: artist.minutes / most,
  }))
}

/** Tags by time listened: a song with two tags counts for both. */
export function rankedTags(top: readonly TopEntry[], limit = RANKED_ROWS): RankedRow[] {
  const rows = [...top].sort((a, b) => b.minutes - a.minutes || b.plays - a.plays).slice(0, limit)
  const most = Math.max(1, rows[0]?.minutes ?? 0)
  return rows.map((tag, index) => ({
    kind: 'tag',
    key: `tag-${tag.key}`,
    rank: index + 1,
    name: tag.key,
    trailing: durationWords(tag.minutes),
    share: tag.minutes / most,
  }))
}

export function rankedRows(
  stats: Pick<Stats, 'topSongs' | 'topArtists' | 'topTags'>,
  kind: RankKind,
  limit = RANKED_ROWS,
): RankedRow[] {
  if (kind === 'songs') return rankedSongs(stats.topSongs, limit)
  if (kind === 'artists') return rankedArtists(stats.topArtists, limit)
  return rankedTags(stats.topTags, limit)
}

/** What an empty list says, so a window with plays but no tags does not look broken. */
export function rankedEmpty(kind: RankKind): string {
  if (kind === 'tags') return 'No tagged songs played in this window'
  return 'Nothing played in this window'
}
