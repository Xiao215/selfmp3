import { formatRelative, type Stats } from '@selfmp3/shared'
import type { DevicePlace } from '../settings/settings.model'
import { durationWords, formatHour, peakHour, peakHourWords } from '../stats/stats.model'

/**
 * The Profile page, without the screen (`P31`): who you are and whether this device
 * is in step, this month as one card that opens Stats, then three rows.
 *
 * On a phone Profile is behind the avatar on Home, and Stats lives under it (Open
 * question 7). A computer reaches it from the name row at the foot of its
 * sidebar, and keeps Stats as a sidebar row as well.
 */

export type ProfileRowId = 'import' | 'report' | 'settings'

export interface ProfileRow {
  readonly id: ProfileRowId
  readonly label: string
  readonly href: string
  /** The quiet line under the label: what is behind the row. */
  readonly hint: string
}

/**
 * Import, Report and Settings. Tags left this list when Home's tiles and
 * "All N tags" became the way to them; Stats left it for the card above.
 */
export function profileRows({ place }: { place: DevicePlace }): readonly ProfileRow[] {
  return [
    {
      id: 'import',
      label: 'Import',
      href: '/import',
      hint: 'Paste a link or share one',
    },
    {
      id: 'report',
      label: 'Report',
      href: '/stats/report',
      hint: 'Your week, month or year, as a page',
    },
    {
      id: 'settings',
      label: 'Settings',
      href: '/settings',
      hint: `Account, look, on this ${place}, devices`,
    },
  ]
}

/**
 * The name at the top. Not every kind of library knows one: a server signed in
 * to Google does, a device reading the bucket does not, and a server with no
 * cloud has nobody to ask. Without one the page is just "Profile", and the mark
 * shows the figure rather than a letter.
 */
export function profileName(accountName: string | null | undefined): {
  name: string
  initial: string | null
} {
  const name = accountName?.trim()
  // The page's own name when nobody is signed in: it is Profile, not "You".
  if (!name) return { name: 'Profile', initial: null }
  // The first name, as the board has it; the whole name when it is one word.
  const first = name.split(/\s+/)[0] ?? name
  return { name: first, initial: Array.from(first)[0]?.toUpperCase() ?? null }
}

/**
 * The line under the name: the library, then whether this device has it —
 * "45 songs · 8 tags · synced 4m ago".
 *
 * While the library is first asked for it says so; when it cannot be reached
 * it says that, which is what the line is for.
 */
export function profileLine({
  songs,
  tags,
  syncedAt,
  pending,
  error,
  fromCloud,
  now = new Date(),
}: {
  songs: number | undefined
  tags: number | undefined
  /** When the library last arrived, in ms; 0 or undefined before it has. */
  syncedAt: number | undefined
  pending: boolean
  error: boolean
  fromCloud: boolean
  now?: Date
}): string {
  const parts: string[] = []
  if (songs !== undefined) parts.push(`${songs.toLocaleString()} ${songs === 1 ? 'song' : 'songs'}`)
  if (tags !== undefined) parts.push(`${tags.toLocaleString()} ${tags === 1 ? 'tag' : 'tags'}`)
  if (error) parts.push(fromCloud ? 'can’t reach the cloud' : 'can’t reach your server')
  else if (pending || !syncedAt) parts.push('connecting…')
  else parts.push(`synced ${formatRelative(new Date(syncedAt).toISOString(), now)}`)
  return parts.join(' · ')
}

export interface MonthCard {
  readonly listened: string
  /**
   * "min", where the time is minutes — drawn smaller beside the number, as the
   * streak's "days" is. Baked into the number it was the only figure on the
   * card whose unit shouted (Xiao, 2026-09-22). Hours stay whole: "3h 05" has
   * no word to take off the end.
   */
  readonly listenedUnit?: string
  readonly plays: string
  readonly streak: string
  /** "day" or "days", drawn smaller beside the streak's number. */
  readonly streakUnit: string
  /** The most played song, which the card shows with its cover. */
  readonly onRepeat: { readonly songId: number; readonly title: string } | null
  /**
   * Under it, when you listen: "Night owl · most at 11pm". The board has the
   * Report's personality line here; that needs the report's own numbers, and
   * the busiest hour says the part of it these numbers can back.
   */
  readonly when: string | null
}

/**
 * This month as one card: listened, plays, streak, and what was on repeat.
 * From the window Stats opens on, so the card and the page it opens agree.
 * Nothing until the numbers are known: a cloud library has them only once it
 * has reached its server, and the card then says where they come from instead.
 */
export function monthCard(stats: Stats | undefined): MonthCard | null {
  if (!stats) return null
  const top = stats.topSongs[0]
  const peak = peakHour(stats.hourly)
  return {
    ...listenedFigure(stats.totals.minutes),
    plays: stats.totals.plays.toLocaleString(),
    streak: stats.streakDays.toLocaleString(),
    streakUnit: stats.streakDays === 1 ? 'day' : 'days',
    onRepeat: top ? { songId: top.songId, title: top.title } : null,
    when: peak ? `${peakHourWords(peak.hour)} · most at ${formatHour(peak.hour)}` : null,
  }
}

/** The time listened, split into the number and the word after it where there is one. */
function listenedFigure(minutes: number): { listened: string; listenedUnit?: string } {
  const whole = durationWords(minutes)
  const split = /^(\d+) (min)$/.exec(whole)
  return split ? { listened: split[1] ?? whole, listenedUnit: split[2] } : { listened: whole }
}

/** What the card is called: the window it counts, said plainly. */
export const MONTH_CARD_TITLE = 'Last 30 days'

/** Read out for the whole card, which is one link. */
export function monthCardSpoken(card: MonthCard | null): string {
  if (!card) return 'Stats'
  const repeat = card.onRepeat ? `, on repeat: ${card.onRepeat.title}` : ''
  return `Stats. ${MONTH_CARD_TITLE}: ${card.listened} listened, ${card.plays} ${
    card.plays === '1' ? 'play' : 'plays'
  }, a streak of ${card.streak} ${card.streakUnit}${repeat}`
}

/**
 * The letters on the round mark when the account has no picture: one from
 * each of the first two words of the name, or the first of the address.
 * Null when there is neither, and the plain figure is drawn instead.
 */
export function accountInitials(
  account: { name: string | null; email: string } | null,
): string | null {
  const name = account?.name?.trim()
  if (name) {
    const letters = name
      .split(/\s+/)
      .slice(0, 2)
      .map(word => Array.from(word)[0]?.toUpperCase() ?? '')
      .join('')
    if (letters) return letters
  }
  const email = account?.email.trim()
  return email ? (Array.from(email)[0]?.toUpperCase() ?? null) : null
}
