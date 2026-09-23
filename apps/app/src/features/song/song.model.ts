import { formatDuration, fromSqliteTime, type AudioFeatures, type Song } from '@selfmp3/shared'

/**
 * The words and numbers on a song's own page (docs/ui-mock `P15`), worked out
 * here so the page only draws them.
 *
 * What the page knows comes from two places. The song record always says how
 * often it has been played, when it was added and when it was last played.
 * The server's play history says *when* each play was, but only the latest
 * few hundred across the whole library, and only while the server can be
 * reached; everything built from it (the hour, the busiest day, the strip)
 * is left out when it has nothing to say.
 */

/** Where a song's page lives: `/song/<id>`. Every door to it goes through here. */
export function songLink(id: number): string {
  return `/song/${id}`
}

const DAY_MS = 24 * 60 * 60 * 1000

/** A date from the server or the bucket, read as UTC (`fromSqliteTime`). */
function parseWhen(value: string): Date {
  return new Date(fromSqliteTime(value))
}

/** How long ago, in the words a person uses: "today", "3 weeks ago", "a year ago". */
export function timeAgo(value: string, now: Date): string {
  const then = parseWhen(value)
  if (Number.isNaN(then.getTime())) return 'a while ago'
  // By calendar day, so a song added last night is "yesterday" this morning.
  const days = Math.round((startOfDay(now) - startOfDay(then)) / DAY_MS)
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

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/**
 * "You and this song" as one sentence, cut where the page changes the ink:
 * the number is drawn in the serif and the time in full white.
 */
interface SongStory {
  /** The big number; null when it has never been played. */
  readonly count: number | null
  /** The words between the number and the time. */
  readonly lead: string
  /** When it was added: "3 weeks ago". */
  readonly when: string
  /** The rest, ending in a full stop. */
  readonly tail: string
}

/**
 * The sentence, from the record and whatever plays the history holds for this
 * song (`playedAt`, newest or oldest first, it does not matter).
 *
 * The habit ("Mostly around 11 pm, and six times on one Saturday") needs three
 * plays at least to be a habit; without one, the last play is said instead.
 */
export function songStory(
  song: Pick<Song, 'playCount' | 'addedAt' | 'lastPlayedAt'>,
  playedAt: readonly string[],
  now: Date,
): SongStory {
  const when = timeAgo(song.addedAt, now)
  if (song.playCount === 0) {
    return { count: null, lead: 'Not played yet. You added it ', when, tail: '.' }
  }
  const lead = ` ${song.playCount === 1 ? 'play' : 'plays'} since you added it `
  const dates = playedAt.map(parseWhen).filter(date => !Number.isNaN(date.getTime()))
  const hour = usualHour(dates)
  const day = busiestDay(dates)
  if (hour !== null) {
    const busy = day ? `, and ${numberWord(day.plays)} times on one ${day.weekday}` : ''
    return { count: song.playCount, lead, when, tail: `. Mostly around ${hourWords(hour)}${busy}.` }
  }
  const last = song.lastPlayedAt ? ` Last played ${timeAgo(song.lastPlayedAt, now)}.` : ''
  return { count: song.playCount, lead, when, tail: `.${last}` }
}

/**
 * The hour most plays fall around, counting the hour either side with it so
 * 10:50 and 11:10 agree. Only when at least three plays are known and half of
 * them sit in that window; otherwise there is no "mostly" to speak of.
 */
export function usualHour(dates: readonly Date[]): number | null {
  if (dates.length < 3) return null
  const byHour = new Array<number>(24).fill(0)
  for (const date of dates) byHour[date.getHours()] = (byHour[date.getHours()] ?? 0) + 1
  let best = -1
  let bestCount = 0
  for (let hour = 0; hour < 24; hour++) {
    const around =
      (byHour[(hour + 23) % 24] ?? 0) + (byHour[hour] ?? 0) + (byHour[(hour + 1) % 24] ?? 0)
    // Ties go to the hour that itself holds more plays, then to the earlier one.
    if (around > bestCount || (around === bestCount && (byHour[hour] ?? 0) > (byHour[best] ?? 0))) {
      best = hour
      bestCount = around
    }
  }
  return bestCount * 2 >= dates.length ? best : null
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** The one day it was played most, when that was three times or more. */
export function busiestDay(
  dates: readonly Date[],
): { readonly plays: number; readonly weekday: string } | null {
  const byDay = new Map<number, { plays: number; weekday: string }>()
  for (const date of dates) {
    const key = startOfDay(date)
    const entry = byDay.get(key) ?? { plays: 0, weekday: WEEKDAYS[date.getDay()] ?? '' }
    entry.plays += 1
    byDay.set(key, entry)
  }
  let best: { plays: number; weekday: string } | null = null
  for (const entry of byDay.values()) if (!best || entry.plays > best.plays) best = entry
  return best && best.plays >= 3 ? best : null
}

/** "11 pm", "noon", "midnight", "9 am". */
export function hourWords(hour: number): string {
  if (hour === 0) return 'midnight'
  if (hour === 12) return 'noon'
  return hour < 12 ? `${hour} am` : `${hour - 12} pm`
}

const WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
]

/** Small numbers in words, as a sentence says them; larger ones in digits. */
function numberWord(n: number): string {
  return WORDS[n] ?? String(n)
}

/**
 * This song's plays out of the server's recent history, and how far back that
 * history reaches: the oldest play in it, of any song. `isThisSong` is asked
 * because a history from a cloud library's server names songs by the
 * server's ids, which only the caller can translate.
 */
export function songPlays(
  events: readonly { readonly songId: number; readonly playedAt: string }[],
  isThisSong: (songId: number) => boolean,
): { readonly playedAt: readonly string[]; readonly coveredFrom: string | null } {
  let coveredFrom: string | null = null
  let oldest = Infinity
  const playedAt: string[] = []
  for (const event of events) {
    const at = parseWhen(event.playedAt).getTime()
    if (at < oldest) {
      oldest = at
      coveredFrom = event.playedAt
    }
    if (isThisSong(event.songId)) playedAt.push(event.playedAt)
  }
  return { playedAt, coveredFrom }
}

/** The history strip: bars from 0 to 1, oldest first, and the tallest one. */
export interface PlayStrip {
  readonly bars: readonly number[]
  readonly peak: number
}

/**
 * The plays spread over the song's time in the library, in equal slices.
 *
 * The history reaches back only so far (`coveredFrom`, its oldest play of any
 * song), and a slice before that would read as "not played then" when the
 * truth is "not known". So the strip starts at whichever is later, the day it
 * was added or the start of the history, and it is null when no play of this
 * song falls inside it.
 */
export function playStrip({
  playedAt,
  addedAt,
  coveredFrom,
  now,
  slices = 21,
}: {
  playedAt: readonly string[]
  addedAt: string
  coveredFrom: string | null
  now: Date
  slices?: number
}): PlayStrip | null {
  const added = parseWhen(addedAt).getTime()
  const covered = coveredFrom === null ? Number.NaN : parseWhen(coveredFrom).getTime()
  const from = Math.max(
    Number.isNaN(added) ? -Infinity : added,
    Number.isNaN(covered) ? -Infinity : covered,
  )
  const end = now.getTime()
  // A song added this morning still gets a day's width, so its plays spread out.
  const start = Number.isFinite(from) ? Math.min(from, end - DAY_MS) : end - DAY_MS
  const width = (end - start) / slices
  const counts = new Array<number>(slices).fill(0)
  for (const value of playedAt) {
    const at = parseWhen(value).getTime()
    if (Number.isNaN(at) || at < start || at > end) continue
    const slice = Math.min(slices - 1, Math.floor((at - start) / width))
    counts[slice] = (counts[slice] ?? 0) + 1
  }
  const most = Math.max(...counts)
  if (most === 0) return null
  return { bars: counts.map(n => n / most), peak: counts.indexOf(most) }
}

/**
 * The words beside "Sounds like": "tempo 92 · calm". Null for a song the
 * analyser has not reached, which then shows the heading alone.
 */
export function soundWords(features: AudioFeatures | null): string | null {
  if (!features) return null
  const parts = [
    features.bpm != null ? `tempo ${Math.round(features.bpm)}` : null,
    features.energy != null ? energyWord(features.energy) : null,
  ].filter((part): part is string => part !== null)
  return parts.length > 0 ? parts.join(' · ') : null
}

/** A plain word for the energy, in thirds. */
function energyWord(energy: number): string {
  if (energy < 0.34) return 'calm'
  if (energy < 0.67) return 'steady'
  return 'driving'
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
