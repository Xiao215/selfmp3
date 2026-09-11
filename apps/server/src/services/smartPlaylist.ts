import {
  compatibleCamelot,
  type SmartRule,
  type SmartRules,
  type SongSortField,
} from '@selfmp3/shared'

/**
 * Compiling smart-playlist rules into SQL.
 *
 * This is the one place in the server that builds a query string from user
 * input, so it is also the one place worth being paranoid about. Two rules:
 *
 *  1. Every user-supplied *value* becomes a bound parameter, never text spliced
 *     into SQL.
 *  2. Every user-supplied *identifier* (column name, sort field, direction) is
 *     looked up in a fixed map. If it is not in the map it does not exist.
 *
 * Because the rule types are a discriminated union, adding a new rule variant
 * to the shared schema makes this file stop compiling until it is handled —
 * the switch below is exhaustive and TypeScript enforces it.
 */

export interface CompiledQuery {
  readonly sql: string
  readonly params: unknown[]
}

/** Rule field -> real column. Nothing else can reach the query. */
const TEXT_COLUMNS = {
  title: 's.title',
  artist: 's.artist',
  album: 's.album',
  albumArtist: 's.album_artist',
} as const satisfies Record<string, string>

const NUMBER_COLUMNS = {
  playCount: 's.play_count',
  skipCount: 's.skip_count',
  duration: 's.duration',
  year: 's.year',
} as const satisfies Record<string, string>

const DATE_COLUMNS = {
  addedAt: 's.added_at',
  lastPlayedAt: 's.last_played_at',
} as const satisfies Record<string, string>

/**
 * Analysed features live in their own table, so each rule is an EXISTS over
 * it — which also means a song that has not been analysed simply does not
 * match, rather than matching as if its BPM were zero.
 */
const FEATURE_COLUMNS = {
  bpm: 'f.bpm',
  energy: 'f.energy',
  loudness: 'f.loudness_lufs',
} as const satisfies Record<string, string>

const NUMBER_OPERATORS = {
  gt: '>',
  lt: '<',
  eq: '=',
  gte: '>=',
  lte: '<=',
} as const satisfies Record<string, string>

const SORT_COLUMNS = {
  addedAt: 's.added_at',
  title: 's.title COLLATE NOCASE',
  artist: 's.artist COLLATE NOCASE',
  album: 's.album COLLATE NOCASE',
  duration: 's.duration',
  playCount: 's.play_count',
  lastPlayedAt: 's.last_played_at',
  random: 'RANDOM()',
} as const satisfies Record<SongSortField, string>

/** Escape the wildcards so a literal `%` in a title cannot match everything. */
function likeContains(value: string): string {
  return `%${value.replace(/[\\%_]/g, char => `\\${char}`)}%`
}

function likePrefix(value: string): string {
  return `${value.replace(/[\\%_]/g, char => `\\${char}`)}%`
}

function compileRule(rule: SmartRule): CompiledQuery {
  switch (rule.field) {
    case 'title':
    case 'artist':
    case 'album':
    case 'albumArtist': {
      const column = TEXT_COLUMNS[rule.field]
      switch (rule.op) {
        case 'contains':
          return { sql: `${column} LIKE ? ESCAPE '\\'`, params: [likeContains(rule.value)] }
        case 'notContains':
          return { sql: `${column} NOT LIKE ? ESCAPE '\\'`, params: [likeContains(rule.value)] }
        case 'equals':
          return { sql: `${column} = ? COLLATE NOCASE`, params: [rule.value] }
        case 'startsWith':
          return { sql: `${column} LIKE ? ESCAPE '\\'`, params: [likePrefix(rule.value)] }
      }
      break
    }

    case 'tag': {
      const subquery = 'SELECT 1 FROM song_tags st WHERE st.song_id = s.id AND st.tag_id = ?'
      return rule.op === 'has'
        ? { sql: `EXISTS (${subquery})`, params: [rule.tagId] }
        : { sql: `NOT EXISTS (${subquery})`, params: [rule.tagId] }
    }

    case 'playCount':
    case 'skipCount':
    case 'duration':
    case 'year': {
      const column = NUMBER_COLUMNS[rule.field]
      const operator = NUMBER_OPERATORS[rule.op]
      // `year` is nullable; a null should not satisfy a numeric comparison.
      return { sql: `(${column} IS NOT NULL AND ${column} ${operator} ?)`, params: [rule.value] }
    }

    case 'addedAt':
    case 'lastPlayedAt': {
      const column = DATE_COLUMNS[rule.field]
      switch (rule.op) {
        case 'never':
          return { sql: `${column} IS NULL`, params: [] }
        case 'inLastDays': {
          const days = rule.days ?? 30
          return {
            sql: `(${column} IS NOT NULL AND ${column} >= datetime('now', ?))`,
            params: [`-${days} days`],
          }
        }
        case 'notInLastDays': {
          const days = rule.days ?? 30
          // "Not played in the last N days" should include never-played songs,
          // which is what people actually mean by "forgotten".
          return {
            sql: `(${column} IS NULL OR ${column} < datetime('now', ?))`,
            params: [`-${days} days`],
          }
        }
      }
      break
    }

    case 'loved':
      return { sql: `s.loved = ?`, params: [rule.value ? 1 : 0] }

    case 'hasLyrics':
      return rule.value
        ? { sql: `s.lyrics_kind != 'none'`, params: [] }
        : { sql: `s.lyrics_kind = 'none'`, params: [] }

    case 'hasArt':
      return { sql: `s.has_art = ?`, params: [rule.value ? 1 : 0] }

    case 'bpm':
    case 'energy':
    case 'loudness': {
      const column = FEATURE_COLUMNS[rule.field]
      const operator = NUMBER_OPERATORS[rule.op]
      return {
        sql: `EXISTS (SELECT 1 FROM song_features f WHERE f.song_id = s.id AND ${column} IS NOT NULL AND ${column} ${operator} ?)`,
        params: [rule.value],
      }
    }

    case 'key': {
      // The schema has already validated the code, and the compatible set is
      // computed here rather than trusted from the client.
      const codes = rule.op === 'is' ? [rule.value.toUpperCase()] : compatibleCamelot(rule.value)
      if (codes.length === 0) return { sql: '0', params: [] }
      const placeholders = codes.map(() => '?').join(', ')
      return {
        sql: `EXISTS (SELECT 1 FROM song_features f WHERE f.song_id = s.id AND f.camelot IN (${placeholders}))`,
        params: codes,
      }
    }
  }

  // Unreachable while the union is fully handled above; kept so an unhandled
  // future variant fails loudly instead of silently matching everything.
  throw new Error(`unsupported smart-playlist rule: ${JSON.stringify(rule)}`)
}

/**
 * Build the id query for a rule set.
 *
 * Missing files are excluded — a smart playlist should never hand the player a
 * track it cannot stream.
 */
export function compileSmartRules(rules: SmartRules): CompiledQuery {
  const params: unknown[] = []
  const conditions: string[] = ['s.missing = 0']

  const compiled = rules.rules.map(compileRule)
  if (compiled.length > 0) {
    const joiner = rules.match === 'any' ? ' OR ' : ' AND '
    conditions.push(`(${compiled.map(c => c.sql).join(joiner)})`)
    for (const item of compiled) params.push(...item.params)
  }

  const orderColumn = SORT_COLUMNS[rules.orderBy]
  const direction = rules.order === 'asc' ? 'ASC' : 'DESC'
  // RANDOM() takes no direction, and nulls should sort last either way.
  const orderBy =
    rules.orderBy === 'random'
      ? 'RANDOM()'
      : `${orderColumn} ${direction} NULLS LAST, s.id ${direction}`

  let sql = `SELECT s.id FROM songs s WHERE ${conditions.join(' AND ')} ORDER BY ${orderBy}`

  if (rules.limit !== null) {
    sql += ' LIMIT ?'
    params.push(rules.limit)
  }

  return { sql, params }
}

/** Human-readable summary of a rule set — shared now, so a device can say it too. */
export { describeSmartRules } from '@selfmp3/shared'
