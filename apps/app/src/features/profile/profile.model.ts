import { plural, type Stats } from '@selfmp3/shared'
import { unreachableLabel } from '../library/library.model'
import {
  formatHour,
  peakHour,
  peakHourWords,
  REPORT_HINT,
  statFigures,
  type StatFigures,
} from '../stats/stats.model'

/**
 * The Profile page, without the screen (`P31`): who you are and how big your
 * library is, this month as one card that opens Stats, then the rows under it.
 *
 * On a phone Profile is behind the avatar on Home, and Stats lives under it (Open
 * question 7). A computer reaches it from the name row at the foot of its
 * sidebar, and keeps Stats as a sidebar row as well.
 */

export type ProfileRowId = 'import' | 'report' | 'soundMap' | 'links' | 'settings'

export interface ProfileRow {
  readonly id: ProfileRowId
  readonly label: string
  readonly href: string
  /** The quiet line under the label: what is behind the row. */
  readonly hint: string
}

/**
 * Import, Report, Sound map, Links you shared and Settings. Tags are reached from Home's
 * tiles and "All N tags", and Stats from the card above. Links you shared is
 * there for a signed-in account, the only kind that can send one; `linksHint`
 * says how many play.
 */
export function profileRows({
  linksHint,
}: {
  /** The line under Links you shared, or null where no link can be sent. */
  linksHint: string | null
}): readonly ProfileRow[] {
  return [
    {
      id: 'import',
      label: 'Import',
      href: '/import',
      hint: 'From a link or a search',
    },
    {
      id: 'report',
      label: 'Report',
      href: '/stats/report',
      hint: REPORT_HINT,
    },
    {
      id: 'soundMap',
      label: 'Sound map',
      href: '/sound-map',
      hint: 'Your songs, placed by how they sound',
    },
    ...(linksHint === null
      ? []
      : [{ id: 'links' as const, label: 'Links you shared', href: '/links', hint: linksHint }]),
    {
      id: 'settings',
      label: 'Settings',
      href: '/settings',
      hint: 'Account, look, devices',
    },
  ]
}

/**
 * The first word of the name Google gave — "Xiao" from "Xiao Zhang", the whole
 * name when it is one word — or null when there is no name to go by.
 */
export function firstName(name: string | null | undefined): string | null {
  return name?.trim().split(/\s+/)[0] || null
}

/**
 * The name at the top: the account's first name, as the board has it. A server
 * with no cloud has nobody to ask, and then the page is just "Profile" — its
 * own name, not "You".
 */
export function profileName(accountName: string | null | undefined): string {
  return firstName(accountName) ?? 'Profile'
}

/**
 * The line under the name: how big the library is — "45 songs · 8 tags".
 *
 * When it cannot be reached it says that too, which a phone has nowhere else
 * to say. Being in step is the normal case and is not announced: "synced
 * just now" would be a word about plumbing on every visit.
 */
export function profileLine({
  songs,
  tags,
  error,
}: {
  songs: number | undefined
  tags: number | undefined
  /** Why the library did not come; null (or false) while it has. */
  error: unknown
}): string {
  const parts: string[] = []
  if (songs !== undefined) parts.push(plural(songs, 'song', 'songs'))
  if (tags !== undefined) parts.push(plural(tags, 'tag', 'tags'))
  if (error) {
    const label = unreachableLabel(error)
    parts.push(parts.length > 0 ? label.charAt(0).toLowerCase() + label.slice(1) : label)
  }
  return parts.join(' · ')
}

export interface MonthCard extends StatFigures {
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
    ...statFigures(stats),
    onRepeat: top ? { songId: top.songId, title: top.title } : null,
    when: peak ? `${peakHourWords(peak.hour)} · most at ${formatHour(peak.hour)}` : null,
  }
}

/** What the card is called: the window it counts, said plainly. */
export const MONTH_CARD_TITLE = 'Last 30 days'

/** Read out for the whole card, which is one link. */
export function monthCardSpoken(card: MonthCard | null): string {
  if (!card) return 'Stats'
  const repeat = card.onRepeat ? `, on repeat: ${card.onRepeat.title}` : ''
  return `Stats. ${MONTH_CARD_TITLE}: ${card.listened} listened, ${card.plays} ${
    card.playsCaption
  }, a streak of ${card.streak} ${card.streakUnit}${repeat}`
}
