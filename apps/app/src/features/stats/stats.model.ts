import type {
  HourBand,
  HourlyPlays,
  Stats,
  StatsRange,
  TopEntry,
  TopSong,
  WrappedRange,
} from '@selfmp3/shared'
import {
  plural,
  artistKey,
  formatListenTime,
  hourBand,
  localDayKey,
  splitArtists,
  UNKNOWN_ARTIST,
} from '@selfmp3/shared'

/**
 * Listening stats, without the screen.
 *
 * Everything on the page is derived from stored play events, so the questions
 * can change later without the data having been thrown away. The page is a few
 * cards, each one number with a small picture of where it came from (`P32`,
 * `C15`), then one ranked module of what was played most.
 */

/**
 * The window the page shows. The same five windows as the Report's, by the
 * same names, so Stats and the Report share this list, its labels and the
 * endpoint's name for each (`statsRangeFor`).
 */
export type StatsPeriod = WrappedRange

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

/** What is behind "Report", under its name wherever it is a row. */
export const REPORT_HINT = 'Your week, month or year, as a page'

/** Whether an address's `range` names one of the windows. */
export function isStatsPeriod(value: string | undefined): value is StatsPeriod {
  return (STATS_PERIODS as readonly string[]).includes(value ?? '')
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
 * What the busiest hour says about you, under Peak hour: read off the shared
 * `hourBand` (`packages/shared/src/personality.ts`), the bands the Report's
 * "Night owl" and "Early bird" traits count in and its "mostly at night"
 * names, so none of them disagree about when night starts.
 */
const PEAK_HOUR_WORDS: Record<HourBand, string> = {
  night: 'Night owl',
  early: 'Early bird',
  day: 'Daytime listener',
  evening: 'Evening listener',
}

export function peakHourWords(hour: number): string {
  return PEAK_HOUR_WORDS[hourBand(hour)]
}

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

// ------------------------------------------------------------------ the cards

interface ListenedCard {
  readonly value: string
  /** "128 plays · 22 days". */
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
    value: formatListenTime(stats.totals.minutes),
    line: `${playsLabel(stats.totals.plays)} · ${plural(active, 'day', 'days')}`,
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

/** One square of the strip under Streak: a day, or a week in a long window. */
interface StreakSquare {
  /** Its last day, as a local day key. */
  readonly date: string
  /** Music on it (on any of its days, for a week). */
  readonly played: boolean
  /** Part of the run still going: drawn in the accent. */
  readonly inRun: boolean
  /** It holds today: ringed. */
  readonly today: boolean
}

interface StreakCard {
  readonly value: string
  /** "Sep 6 to 14", or the best run when there is no run now. */
  readonly line: string | undefined
  /** The window as one strip, oldest first: a square a day, or a week for 3 months and a year. */
  readonly squares: readonly StreakSquare[]
  /** Under the strip's first square: "Sep 26". Its last says "today". */
  readonly from: string
}

/**
 * The most days the strip under Streak covers a day at a time: a month. A
 * week's window has seven, since the days before it were not asked about and
 * would read as days without music. All time keeps to the last month.
 */
const STREAK_DAYS = 30

/** A long window's squares are weeks: 13 for three months, 52 for a year. */
const STREAK_WEEKS: Partial<Record<Stats['range'], number>> = { '90d': 13, '365d': 52 }

/**
 * Streak: the run of days with music that is still going, and the window it
 * sits in as one strip of squares — the run in the accent, the other days with
 * music filled, today ringed (X1).
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
  const todayIso = localDayKey(today)
  const runEnd = played.has(todayIso) ? today : daysBefore(today, 1)
  const run = new Set(
    Array.from({ length: stats.streakDays }, (_, back) => localDayKey(daysBefore(runEnd, back))),
  )

  const weeks = STREAK_WEEKS[stats.range]
  const span = weeks ? 7 : 1
  // All time lists only the days with plays; every other window has a day for each day.
  const count =
    weeks ?? (stats.range === 'all' ? STREAK_DAYS : Math.min(STREAK_DAYS, stats.daily.length))
  const squares = Array.from({ length: count }, (_, index) => {
    const last = daysBefore(today, (count - 1 - index) * span)
    const days = Array.from({ length: span }, (_, back) => localDayKey(daysBefore(last, back)))
    return {
      date: localDayKey(last),
      played: days.some(day => played.has(day)),
      inRun: days.some(day => run.has(day)),
      today: index === count - 1,
    }
  })
  const first = daysBefore(today, (count - 1) * span + span - 1)
  const from = `${first.toLocaleDateString(undefined, { month: 'short' })} ${first.getDate()}`

  if (stats.streakDays === 0) {
    return { value: daysLabel(0), line: bestStreakHint(stats.longestStreakDays), squares, from }
  }
  const start = daysBefore(runEnd, stats.streakDays - 1)
  return { value: daysLabel(stats.streakDays), line: spanWords(start, runEnd), squares, from }
}

/**
 * "Sep 6 to 14", "Aug 30 to Sep 3", or one day alone: "Sep 14". A run that
 * began in another year says which: "Dec 30, 2023 to Oct 25", not a span
 * that reads like ten months.
 */
export function spanWords(start: Date, end: Date): string {
  const month = (date: Date): string => date.toLocaleDateString(undefined, { month: 'short' })
  if (localDayKey(start) === localDayKey(end)) return `${month(end)} ${end.getDate()}`
  const sameYear = start.getFullYear() === end.getFullYear()
  const sameMonth = sameYear && start.getMonth() === end.getMonth()
  const from = `${month(start)} ${start.getDate()}${sameYear ? '' : `, ${start.getFullYear()}`}`
  return `${from} to ${sameMonth ? '' : `${month(end)} `}${end.getDate()}`
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
 * Artists by time listened. The server has already split each credit into
 * the artists it names (a collaboration counts for everyone in it), the way
 * the rest of the app splits them.
 */
export function rankedArtists(top: readonly TopEntry[], limit = RANKED_ROWS): RankedRow[] {
  const rows = top
    .map(entry => ({ name: entry.key, minutes: entry.minutes, plays: entry.plays }))
    .sort((a, b) => b.minutes - a.minutes || b.plays - a.plays || a.name.localeCompare(b.name))
    .slice(0, limit)
  const most = Math.max(1, rows[0]?.minutes ?? 0)
  return rows.map((artist, index) => ({
    kind: 'artist',
    key: `artist-${artistKey(artist.name)}`,
    rank: index + 1,
    name: artist.name,
    known: artist.name !== UNKNOWN_ARTIST,
    trailing: formatListenTime(artist.minutes),
    share: artist.minutes / most,
  }))
}

/**
 * The song whose cover stands in for an artist the server has no picture of:
 * theirs played most in this window, or, when none of those has a cover, any
 * of theirs that has. A collaboration is theirs, as it counts for them above.
 */
export function artistCoverSong<S extends { readonly artist: string; readonly hasArt: boolean }>(
  name: string,
  played: readonly S[],
  library: readonly S[],
): S | undefined {
  const key = artistKey(name)
  const theirs = (song: S): boolean =>
    song.hasArt && splitArtists(song.artist).some(named => artistKey(named) === key)
  return played.find(theirs) ?? library.find(theirs)
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
    trailing: formatListenTime(tag.minutes),
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

/**
 * A window's three headline numbers, as Home's This week and You's month card
 * both draw them: time listened ("2h", "3h 05", "42" and "min"), plays and
 * the streak, each grouped as the reader's locale groups ("1,234"). One
 * reading, so the same week does not say "2h 00" on Home and "2h" on You.
 */
export interface StatFigures {
  readonly listened: string
  /**
   * "min", where the time is minutes — drawn smaller beside the number, as the
   * streak's "days" is. Baked into the number it would be the only figure on
   * the card whose unit shouted. Hours stay whole: "3h 05" has no word to
   * take off the end.
   */
  readonly listenedUnit?: string
  readonly plays: string
  /** "play" or "plays", the caption under the plays. */
  readonly playsCaption: string
  readonly streak: string
  /** "day" or "days", drawn smaller beside the streak's number. */
  readonly streakUnit: string
}

export function statFigures(stats: Pick<Stats, 'totals' | 'streakDays'>): StatFigures {
  const whole = formatListenTime(stats.totals.minutes)
  const minutes = /^(<?\d+) (min)$/.exec(whole)
  return {
    ...(minutes
      ? { listened: minutes[1] ?? whole, listenedUnit: minutes[2] }
      : { listened: whole }),
    plays: stats.totals.plays.toLocaleString(),
    playsCaption: stats.totals.plays === 1 ? 'play' : 'plays',
    streak: stats.streakDays.toLocaleString(),
    streakUnit: stats.streakDays === 1 ? 'day' : 'days',
  }
}
