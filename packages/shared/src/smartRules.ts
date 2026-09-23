import { compatibleCamelot } from './audioFeatures.js'
import { assertNever } from './exhaustive.js'
import type { CloudSmartRule, CloudSmartRules, CloudSong } from './schemas/cloud.js'
import type { SongSortField } from './schemas/common.js'
import { asciiLower, toSqliteTime } from './sync.js'

/**
 * Live playlists on a device (docs/SYNC.md): the rules the server compiles to
 * SQL (apps/server/src/services/smartPlaylist.ts), run over the library in
 * memory instead. So a playlist of loved songs gains a song the moment it is
 * loved on a phone, with the server asleep. A test runs both over one library
 * and expects the same songs in the same order.
 *
 * Text matches the way SQLite's LIKE and NOCASE do: ignoring the case of A–Z
 * and only of A–Z. Two songs that tie on the sort field are ordered by when
 * they were added and then by uid — the two keys both sides carry. A row id
 * would not do: a server that adopted a bucket gave its ids out in the
 * snapshot's order, which is the reverse of the library's.
 */
export function livePlaylistSongs(
  rules: CloudSmartRules,
  songs: readonly CloudSong[],
  options: { now?: number; random?: () => number } = {},
): string[] {
  const now = options.now ?? Date.now()
  const random = options.random ?? Math.random
  const matches = rules.rules.map(rule => matcher(rule, now))
  const keep = (song: CloudSong): boolean =>
    matches.length === 0 ||
    (rules.match === 'any'
      ? matches.some(match => match(song))
      : matches.every(match => match(song)))

  const kept = songs.filter(keep)

  let ordered: CloudSong[]
  if (rules.orderBy === 'random') {
    ordered = kept
      .map(song => ({ song, sort: random() }))
      .sort((a, b) => a.sort - b.sort)
      .map(({ song }) => song)
  } else {
    const value = SORT_VALUES[rules.orderBy]
    const direction = rules.order === 'asc' ? 1 : -1
    ordered = [...kept].sort(
      (a, b) =>
        compareNullsLast(value(a), value(b), direction) ||
        compareNullsLast(a.addedAt, b.addedAt, direction) ||
        compareNullsLast(a.uid, b.uid, direction),
    )
  }

  const limited = rules.limit === null ? ordered : ordered.slice(0, rules.limit)
  return limited.map(song => song.uid)
}

type SortValue = string | number | null

const SORT_VALUES: Record<Exclude<SongSortField, 'random'>, (song: CloudSong) => SortValue> = {
  addedAt: song => song.addedAt,
  title: song => asciiLower(song.title),
  artist: song => asciiLower(song.artist),
  album: song => asciiLower(song.album),
  duration: song => song.duration,
  playCount: song => song.playCount,
  lastPlayedAt: song => song.lastPlayedAt,
}

/** SQL's `ORDER BY … NULLS LAST`: nulls go last whichever way the rest sorts. */
function compareNullsLast(a: SortValue, b: SortValue, direction: 1 | -1): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1
  return (a < b ? -1 : a > b ? 1 : 0) * direction
}

function compareNumber(op: 'gt' | 'lt' | 'eq' | 'gte' | 'lte', a: number, b: number): boolean {
  switch (op) {
    case 'gt':
      return a > b
    case 'lt':
      return a < b
    case 'eq':
      return a === b
    case 'gte':
      return a >= b
    case 'lte':
      return a <= b
  }
}

function matcher(rule: CloudSmartRule, now: number): (song: CloudSong) => boolean {
  switch (rule.field) {
    case 'title':
    case 'artist':
    case 'album':
    case 'albumArtist': {
      const field = rule.field
      const value = asciiLower(rule.value)
      switch (rule.op) {
        case 'contains':
          return song => asciiLower(song[field]).includes(value)
        case 'notContains':
          return song => !asciiLower(song[field]).includes(value)
        case 'equals':
          return song => asciiLower(song[field]) === value
        case 'startsWith':
          return song => asciiLower(song[field]).startsWith(value)
        default:
          return assertNever(rule)
      }
    }

    case 'tag':
      return rule.op === 'has'
        ? song => song.tagUids.includes(rule.tagUid)
        : song => !song.tagUids.includes(rule.tagUid)

    case 'playCount':
    case 'skipCount':
    case 'duration':
    case 'year': {
      const field = rule.field
      // A song with no year does not satisfy any comparison with one.
      return song => {
        const value = song[field]
        return value !== null && compareNumber(rule.op, value, rule.value)
      }
    }

    case 'addedAt':
    case 'lastPlayedAt': {
      const field = rule.field
      if (rule.op === 'never') return song => song[field] === null
      const since = toSqliteTime(now - rule.days * 24 * 60 * 60 * 1000)
      // "Not played in the last N days" includes never played, as the SQL does.
      return rule.op === 'inLastDays'
        ? song => song[field] !== null && (song[field] ?? '') >= since
        : song => song[field] === null || (song[field] ?? '') < since
    }

    case 'loved':
      return song => song.loved === rule.value

    case 'hasLyrics':
      return song => (song.lyrics !== null) === rule.value

    case 'hasArt':
      return song => (song.cover !== null) === rule.value

    case 'bpm':
    case 'energy':
    case 'loudness': {
      const read = (song: CloudSong): number | null | undefined =>
        rule.field === 'bpm'
          ? song.audioFeatures?.bpm
          : rule.field === 'energy'
            ? song.audioFeatures?.energy
            : song.audioFeatures?.loudnessLufs
      // A song not analysed yet matches no feature rule, as in the SQL.
      return song => {
        const value = read(song)
        return value != null && compareNumber(rule.op, value, rule.value)
      }
    }

    case 'key': {
      const codes = new Set(
        rule.op === 'is' ? [rule.value.toUpperCase()] : compatibleCamelot(rule.value),
      )
      return song => song.audioFeatures?.camelot != null && codes.has(song.audioFeatures.camelot)
    }

    default:
      return assertNever(rule)
  }
}
