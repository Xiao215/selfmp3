import { compatibleCamelot } from './audioFeatures.js'
import type { CloudSmartRule, CloudSmartRules, CloudSong } from './schemas/cloud.js'
import type { SongSortField } from './schemas/common.js'
import type { SmartRules } from './schemas/smart.js'
import { asciiLower, toSqliteTime } from './sync.js'

/**
 * Live playlists on a device (docs/SYNC.md): the rules the server compiles to
 * SQL (apps/server/src/services/smartPlaylist.ts), run over the library in
 * memory instead. So a playlist of loved songs gains a song the moment it is
 * loved on a phone, with the server asleep. A test runs both over one library
 * and expects the same songs in the same order.
 *
 * Text matches the way SQLite's LIKE and NOCASE do: ignoring the case of A–Z
 * and only of A–Z. Songs are expected newest first, as a snapshot lists them;
 * that order stands in for the server's row ids when two songs tie.
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
  }
  throw new Error(`unsupported smart-playlist rule: ${JSON.stringify(rule)}`)
}

const COMPARISONS = { gt: '>', lt: '<', eq: '=', gte: '>=', lte: '<=' } as const

/** Human-readable summary of a rule set, for playlist subtitles. */
export function describeSmartRules(
  rules: SmartRules,
  tagNames: ReadonlyMap<number, string>,
): string {
  if (rules.rules.length === 0) {
    return rules.limit === null ? 'Every song' : `${rules.limit} songs`
  }

  const parts = rules.rules.map(rule => {
    switch (rule.field) {
      case 'title':
      case 'artist':
      case 'album':
      case 'albumArtist': {
        const verb =
          rule.op === 'contains'
            ? 'contains'
            : rule.op === 'notContains'
              ? 'does not contain'
              : rule.op === 'equals'
                ? 'is'
                : 'starts with'
        return `${rule.field} ${verb} "${rule.value}"`
      }
      case 'tag': {
        const name = tagNames.get(rule.tagId) ?? `#${rule.tagId}`
        return rule.op === 'has' ? `tagged ${name}` : `not tagged ${name}`
      }
      case 'playCount':
      case 'skipCount':
      case 'duration':
      case 'year': {
        const symbol = COMPARISONS[rule.op]
        return `${rule.field} ${symbol} ${rule.value}`
      }
      case 'addedAt':
      case 'lastPlayedAt': {
        const label = rule.field === 'addedAt' ? 'added' : 'played'
        if (rule.op === 'never') return `never ${label}`
        const days = rule.days ?? 30
        return rule.op === 'inLastDays'
          ? `${label} in the last ${days} days`
          : `not ${label} in ${days} days`
      }
      case 'loved':
        return rule.value ? 'loved' : 'not loved'
      case 'hasLyrics':
        return rule.value ? 'has lyrics' : 'no lyrics'
      case 'hasArt':
        return rule.value ? 'has art' : 'no art'
      case 'bpm':
      case 'energy':
      case 'loudness': {
        const symbol = COMPARISONS[rule.op]
        const unit = rule.field === 'loudness' ? ' LUFS' : ''
        return `${rule.field} ${symbol} ${rule.value}${unit}`
      }
      case 'key':
        return rule.op === 'is'
          ? `key is ${rule.value.toUpperCase()}`
          : `key mixes with ${rule.value.toUpperCase()}`
    }
  })

  const joined = parts.join(rules.match === 'any' ? ' or ' : ' and ')
  return rules.limit === null ? joined : `${joined} · first ${rules.limit}`
}
