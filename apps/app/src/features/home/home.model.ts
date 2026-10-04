import {
  formatLongDuration,
  plural,
  type Song,
  type Stats,
  type Tag,
  splitArtists,
} from '@selfmp3/shared'
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

/** The week's number one, which leads the Sunday card. */
interface SongOfTheWeek {
  readonly songId: number
  readonly title: string
  /** "Song of the week · 14 plays". */
  readonly note: string
}

export interface SundayCard {
  readonly title: string
  /** How long, whose, the streak: "1 hr 12 min · Yu-Peng Chen, mostly · 3-day streak". */
  readonly line: string
  /** Null when the server named no song, and the card says the week alone. */
  readonly song: SongOfTheWeek | null
}

/**
 * The Sunday card (docs/ui-mock `P06`): on a Sunday, and only then, the week
 * is ready and opens as a page. It is led by the week's most played song, its
 * cover and its colour, so each Sunday looks like its own week (Xiao chose E,
 * 2026-10-04); the line says what the week held — how long, whose, the
 * streak. Not drawn for a week with nothing in it, or before the week's
 * numbers have arrived. No notification: it is there when Home is opened, and
 * gone on Monday.
 */
export function sundayCard(
  now: Date,
  week: Pick<Stats, 'totals' | 'topArtists' | 'topSongs' | 'streakDays'> | undefined,
): SundayCard | null {
  if (now.getDay() !== 0 || !week || week.totals.plays === 0) return null
  const parts = [formatLongDuration(week.totals.minutes * 60)]
  const top = week.topArtists[0]
  const artist = top ? splitArtists(top.key)[0] : undefined
  if (artist) parts.push(`${artist}, mostly`)
  if (week.streakDays >= 2) parts.push(`${week.streakDays}-day streak`)
  const first = week.topSongs[0]
  const song = first
    ? {
        songId: first.songId,
        title: first.title,
        note: `Song of the week · ${plural(first.plays, 'play', 'plays')}`,
      }
    : null
  return { title: 'Your week is ready', line: parts.join(' · '), song }
}
