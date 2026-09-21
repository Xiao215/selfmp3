import { formatLongDuration, type Song, type Stats, type Tag } from '@selfmp3/shared'
import { splitArtists } from '@selfmp3/client'
import { tagsMostPlayed } from '../tag/tag.model'

/**
 * Home, without the screen (docs/ui-mock `P04`, `C03`): what the greeting says,
 * which four tags get a tile, and what was played last.
 *
 * Home is where the app opens. It is a way in rather than a list of
 * everything: the tags you play most, as places, and the songs you were just
 * listening to.
 */

/** How many tags get a tile on a phone: two by two. */
export const HOME_TILES = 4

/** And on a computer, three by two (`C03`). */
export const HOME_TILES_WIDE = 6

/** How many covers the Recently played row holds. */
const HOME_RECENTS = 12

/** "Good evening." by the hour, on this device's clock. */
export function greeting(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good morning'
  if (hour >= 12 && hour < 17) return 'Good afternoon'
  if (hour >= 17 && hour < 22) return 'Good evening'
  return 'Good night'
}

/**
 * The one quiet line under the greeting: the streak, when there is one worth
 * saying ("3 days in a row."), and otherwise nothing. No invented cheer.
 */
export function streakLine(streakDays: number | undefined): string | null {
  if (streakDays === undefined || streakDays < 2) return null
  return `${streakDays} days in a row.`
}

export interface HomeTile {
  readonly tag: Tag
  /** Songs carrying the tag. */
  readonly songs: number
  /** The song whose cover sits tilted in the tile's corner, or null for none. */
  readonly cover: Song | null
}

/**
 * The tags with a tile: the most played, by the plays of the songs they carry,
 * then the biggest, then by name so the order never shuffles on a tie. A tag
 * with no songs has nothing to open onto and gets no tile. Fewer than four
 * tags show what there is; none shows none, and the screen says how to make
 * the first.
 */
export function homeTiles(
  tags: readonly Tag[],
  songs: readonly Song[],
  limit: number = HOME_TILES,
): HomeTile[] {
  // The same order All tags lists them in (tag.model.ts).
  return tagsMostPlayed(tags, songs)
    .filter(standing => standing.songs.length > 0)
    .slice(0, limit)
    .map(({ tag, songs: list }) => ({ tag, songs: list.length, cover: tileCover(list) }))
}

/** The tag's most played song with a cover, or its first song if none has one. */
function tileCover(list: readonly Song[]): Song | null {
  let best: Song | null = null
  for (const song of list) {
    if (!song.hasArt) continue
    if (best === null || song.playCount > best.playCount) best = song
  }
  return best ?? list[0] ?? null
}

/**
 * Recently played: newest first, each song once, and only songs that have been
 * played. `lastPlayedAt` is the server's `YYYY-MM-DD HH:MM:SS`, which sorts as
 * text.
 */
export function recentlyPlayed(songs: readonly Song[], limit: number = HOME_RECENTS): Song[] {
  const seen = new Set<number>()
  return songs
    .filter(song => song.lastPlayedAt !== null && !song.missing)
    .sort((a, b) => (b.lastPlayedAt ?? '').localeCompare(a.lastPlayedAt ?? ''))
    .filter(song => (seen.has(song.id) ? false : (seen.add(song.id), true)))
    .slice(0, limit)
}

/**
 * The Sunday card (docs/ui-mock `P06`): on a Sunday, and only then, one card
 * under the greeting says the week is ready and opens it as a page. It says
 * what the week held — how long, whose, the streak — and is not drawn for a
 * week with nothing in it, or before the week's numbers have arrived. No
 * notification: it is there when Home is opened, and gone on Monday.
 */
export function sundayCard(
  now: Date,
  week: Pick<Stats, 'totals' | 'topArtists' | 'streakDays'> | undefined,
): { readonly title: string; readonly line: string } | null {
  if (now.getDay() !== 0 || !week || week.totals.plays === 0) return null
  const parts = [formatLongDuration(week.totals.minutes * 60)]
  const top = week.topArtists[0]
  const artist = top ? splitArtists(top.key)[0] : undefined
  if (artist) parts.push(`${artist}, mostly`)
  if (week.streakDays >= 2) parts.push(`${week.streakDays}-day streak`)
  return { title: 'Your week is ready', line: parts.join(' · ') }
}
