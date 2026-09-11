import { compatibleCamelot } from './features.js'
import type { CloudSmartRule, CloudSmartRules, CloudSong } from './schemas/cloud.js'
import type { SongSortField } from './schemas/common.js'
import { asciiLower, toSqliteTime } from './sync.js'

/**
 * Smart playlists on a device (docs/SYNC.md): the rules the Mac compiles to
 * SQL (apps/server/src/services/smartPlaylist.ts), run over the library in
 * memory instead. So a playlist of loved songs gains a song the moment it is
 * loved on a phone, with the Mac asleep. A test runs both over one library
 * and expects the same songs in the same order.
 *
 * Text matches the way SQLite's LIKE and NOCASE do: ignoring the case of A–Z
 * and only of A–Z. Songs are expected newest first, as a snapshot lists them;
 * that order stands in for the Mac's row ids when two songs tie.
 */
export function smartPlaylistSongs(
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

  // Newest first in, so the oldest has rank 0: a row id's order.
  const ranked = songs.map((song, index) => ({ song, rank: songs.length - 1 - index }))
  const kept = ranked.filter(entry => keep(entry.song))

  let ordered: typeof kept
  if (rules.orderBy === 'random') {
    ordered = kept
      .map(entry => ({ entry, sort: random() }))
      .sort((a, b) => a.sort - b.sort)
      .map(({ entry }) => entry)
  } else {
    const value = SORT_VALUES[rules.orderBy]
    const direction = rules.order === 'asc' ? 1 : -1
    ordered = [...kept].sort((a, b) => {
      const byValue = compareNullsLast(value(a.song), value(b.song), direction)
      return byValue !== 0 ? byValue : (a.rank - b.rank) * direction
    })
  }

  const limited = rules.limit === null ? ordered : ordered.slice(0, rules.limit)
  return limited.map(entry => entry.song.uid)
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
      }
      break
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
      const since = toSqliteTime(now - (rule.days ?? 30) * 24 * 60 * 60 * 1000)
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
          ? song.features?.bpm
          : rule.field === 'energy'
            ? song.features?.energy
            : song.features?.loudnessLufs
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
      return song => song.features?.camelot != null && codes.has(song.features.camelot)
    }
  }
  throw new Error(`unsupported smart-playlist rule: ${JSON.stringify(rule)}`)
}
