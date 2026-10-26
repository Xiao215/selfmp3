import {
  calendarDaysAgo,
  DAY_MS,
  formatDuration,
  formatListenTime,
  fromSqliteTime,
  plural,
  startOfLocalDay,
  type CameWith,
  type Song,
  type SongHistory,
} from '@selfmp3/shared'
import { sourceName } from '../share/share.model'

/**
 * The words and numbers on a song's own page (docs/ui-mock `P15`), worked out
 * here so the page only draws them.
 *
 * What the page knows comes from two places. The song record always says how
 * often it has been played, when it was added and when it was last played.
 * The server keeps every play of it, and who handed it over, and says so
 * while it can be reached; everything built from that (the first play, the
 * best week, the strip) is left out when no server answers.
 */

/** Where a song's page lives: `/song/<id>`. Every door to it goes through here. */
export function songLink(id: number): string {
  return `/song/${id}`
}

/** A date from the server or the bucket, read as UTC (`fromSqliteTime`). */
function parseWhen(value: string): Date {
  return new Date(fromSqliteTime(value))
}

/** How long ago, in the words a person uses: "today", "3 weeks ago", "a year ago". */
export function timeAgo(value: string, now: Date): string {
  // By calendar day, so a song added last night is "yesterday" this morning.
  const ago = calendarDaysAgo(value, now)
  if (ago === null) return 'a while ago'
  const { days } = ago
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 31) return count(Math.floor(days / 7), 'a week', 'weeks')
  if (days < 365) return count(Math.floor(days / 30.44), 'a month', 'months')
  return count(Math.floor(days / 365.25), 'a year', 'years')
}

function count(n: number, one: string, many: string): string {
  return n <= 1 ? `${one} ago` : `${n} ${many} ago`
}

/** One line of "You and this song": a quiet name, the fact, and a word under it. */
interface StoryRow {
  readonly key: 'came' | 'first' | 'best' | 'last'
  readonly label: string
  readonly value: string
  readonly sub: string
}

/** Weekly plays since the song came in, oldest first, and what the strip says it is. */
export interface WeekStrip {
  /** Each bar from 0 to 1. */
  readonly bars: readonly number[]
  /** The tallest bar, drawn in the accent. */
  readonly peak: number
  /** "Weeks since 3 March", under the strip. */
  readonly caption: string
}

/** "You and this song", worked out: the lines, and the strip when there is one. */
interface SongStory {
  readonly rows: readonly StoryRow[]
  readonly strip: WeekStrip | null
}

/** At most this many bars; a longer stay puts a few weeks in each. */
const STRIP_BARS = 52
/** A strip of fewer weeks than this says nothing the lines do not. */
const STRIP_MIN_WEEKS = 3
/** A best week of fewer plays is just a week. */
const BEST_WEEK_MIN = 3

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/** "3 March", with the year when it is not this one: "3 March 2025". */
function dayWords(date: Date, now: Date): string {
  const day = `${date.getDate()} ${MONTHS[date.getMonth()] ?? ''}`
  return date.getFullYear() === now.getFullYear() ? day : `${day} ${date.getFullYear()}`
}

/** "Today, 23:40", "Yesterday, 08:05", or the day: "3 March". */
export function playedWords(date: Date, now: Date): string {
  const clock = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  const days = Math.round((startOfLocalDay(now) - startOfLocalDay(date)) / DAY_MS)
  if (days === 0) return `Today, ${clock}`
  if (days === 1) return `Yesterday, ${clock}`
  return dayWords(date, now)
}

/** Where it came from, as far as anyone knows: a friend, a site, or a file of yours. */
export function cameFrom(song: Pick<Song, 'sourceUrl'>, cameWith: CameWith | null): string {
  if (cameWith?.kind === 'room') return `from ${cameWith.from}, in a room`
  if (cameWith?.kind === 'link') return `from a link ${cameWith.from} sent`
  return song.sourceUrl ? `from ${sourceName(song.sourceUrl)}` : 'from a file'
}

/** The local Monday a moment falls in, as that midnight's time. */
function weekOf(date: Date): number {
  const monday = new Date(startOfLocalDay(date))
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  return monday.getTime()
}

/** The week after `week`, by the calendar: a clock change makes a week 167 or 169 hours. */
function nextWeek(week: number): number {
  const date = new Date(week)
  date.setDate(date.getDate() + 7)
  return date.getTime()
}

/**
 * The song's history with you (docs/features/wrapped-and-gems.md, "Your story
 * with a song"). `history` is the server's every play of it, or null when no
 * server could be asked: then the lines say only what this device's copy of
 * the song knows — when it came, how often it was played, and the last time —
 * and there is no first play, best week or strip to make up.
 */
export function songStory(
  song: Pick<Song, 'addedAt' | 'sourceUrl' | 'playCount' | 'lastPlayedAt'>,
  history: SongHistory | null,
  now: Date,
): SongStory {
  const rows: StoryRow[] = []
  const added = parseWhen(song.addedAt)
  rows.push({
    key: 'came',
    label: 'Came in',
    value: Number.isNaN(added.getTime()) ? 'A while ago' : dayWords(added, now),
    sub: cameFrom(song, history?.cameWith ?? null),
  })

  if (!history) {
    const last = song.lastPlayedAt ? parseWhen(song.lastPlayedAt) : null
    if (last && !Number.isNaN(last.getTime())) {
      rows.push({
        key: 'last',
        label: 'Last',
        value: playedWords(last, now),
        sub: plural(song.playCount, 'play', 'plays'),
      })
    }
    return { rows, strip: null }
  }

  // The plays by local week, from the hours the server counted them in.
  const weeks = new Map<number, number>()
  for (const hour of history.hours) {
    const at = parseWhen(hour.at)
    if (Number.isNaN(at.getTime())) continue
    const week = weekOf(at)
    weeks.set(week, (weeks.get(week) ?? 0) + hour.plays)
  }

  const first = history.firstPlayedAt ? parseWhen(history.firstPlayedAt) : null
  if (first && !Number.isNaN(first.getTime())) {
    const days = Math.round((startOfLocalDay(first) - startOfLocalDay(added)) / DAY_MS)
    rows.push({
      key: 'first',
      label: 'First',
      value: dayWords(first, now),
      sub: days <= 0 ? 'the day it came' : plural(days, 'day later', 'days later'),
    })
  }

  let best: { week: number; plays: number } | null = null
  for (const [week, plays] of weeks) {
    if (!best || plays > best.plays || (plays === best.plays && week < best.week)) {
      best = { week, plays }
    }
  }
  if (best && best.plays >= BEST_WEEK_MIN) {
    rows.push({
      key: 'best',
      label: 'Best week',
      value: plural(best.plays, 'play', 'plays'),
      sub: `week of ${dayWords(new Date(best.week), now)}`,
    })
  }

  const last = history.lastPlayedAt ? parseWhen(history.lastPlayedAt) : null
  if (last && !Number.isNaN(last.getTime())) {
    rows.push({
      key: 'last',
      label: 'Last',
      value: playedWords(last, now),
      sub: `${plural(history.plays, 'play', 'plays')} · ${formatListenTime(history.msPlayed / 60_000)} in all`,
    })
  }

  return { rows, strip: weekStrip(weeks, first && first < added ? first : added, now) }
}

/**
 * The strip: one bar a week from the week it came in to this one, or a few
 * weeks a bar once there are more than `STRIP_BARS` of them. Null for a stay
 * too short to draw, or one with no plays in it.
 */
function weekStrip(weeks: ReadonlyMap<number, number>, from: Date, now: Date): WeekStrip | null {
  if (Number.isNaN(from.getTime())) return null
  const starts: number[] = []
  for (let week = weekOf(from); week <= weekOf(now); week = nextWeek(week)) starts.push(week)
  if (starts.length < STRIP_MIN_WEEKS) return null
  const per = Math.ceil(starts.length / STRIP_BARS)
  const counts: number[] = []
  starts.forEach((week, index) => {
    const bar = Math.floor(index / per)
    counts[bar] = (counts[bar] ?? 0) + (weeks.get(week) ?? 0)
  })
  const most = Math.max(...counts)
  if (most === 0) return null
  return {
    bars: counts.map(n => n / most),
    peak: counts.indexOf(most),
    caption: `${per === 1 ? 'Weeks since' : 'Since'} ${dayWords(from, now)}`,
  }
}

/**
 * The one quiet line by a song's buttons while it has never been played:
 * "Not played yet · added a month ago". Null once it has plays, which the
 * listening card says instead.
 */
export function unplayedLine(song: Pick<Song, 'playCount' | 'addedAt'>, now: Date): string | null {
  return song.playCount === 0 ? `Not played yet · added ${timeAgo(song.addedAt, now)}` : null
}

/**
 * What follows the artists under the title: "Elma · 4:32", without what is
 * empty. The artists come first and are drawn as links, so they are not here.
 */
export function bylineRest(song: Pick<Song, 'album' | 'duration'>): string {
  return [song.album.trim(), song.duration > 0 ? formatDuration(song.duration) : '']
    .filter(Boolean)
    .join(' · ')
}

/** A similar song played from "Sounds like" goes first, with the rest after it in their order. */
export function playSimilarOrder(ids: readonly number[], chosen: number): number[] {
  return [chosen, ...ids.filter(id => id !== chosen)]
}
