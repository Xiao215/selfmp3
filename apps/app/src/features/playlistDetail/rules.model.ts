import type { SmartRule, SmartRules, SongSortField, Tag } from '@selfmp3/shared'

/**
 * The smart-playlist rule builder's vocabulary, with nothing drawn: which
 * fields there are and how they are grouped, what each can be compared with,
 * the rule a field starts from, and how the live count is put into words.
 *
 * Taken from the web app's `SmartRuleBuilder`, so a rule reads the same on
 * every device, and kept apart from the screen so the parts that build a
 * query — above all the starting rules — are checked by a test.
 */

export type FieldKey = SmartRule['field']

interface Option<T> {
  readonly value: T
  readonly label: string
}

export const FIELD_GROUPS: readonly { label: string; options: readonly Option<FieldKey>[] }[] = [
  {
    label: 'Text',
    options: [
      { value: 'title', label: 'Title' },
      { value: 'artist', label: 'Artist' },
      { value: 'album', label: 'Album' },
      { value: 'albumArtist', label: 'Album artist' },
    ],
  },
  { label: 'Tags', options: [{ value: 'tag', label: 'Tag' }] },
  {
    label: 'Numbers',
    options: [
      { value: 'playCount', label: 'Play count' },
      { value: 'skipCount', label: 'Skip count' },
      { value: 'duration', label: 'Length' },
      { value: 'year', label: 'Year' },
    ],
  },
  {
    label: 'Dates',
    options: [
      { value: 'addedAt', label: 'Date added' },
      { value: 'lastPlayedAt', label: 'Last played' },
    ],
  },
  {
    label: 'Yes / no',
    options: [
      { value: 'loved', label: 'Loved' },
      { value: 'hasLyrics', label: 'Has lyrics' },
      { value: 'hasArt', label: 'Has cover art' },
    ],
  },
  {
    label: 'Audio',
    options: [
      { value: 'bpm', label: 'BPM' },
      { value: 'key', label: 'Key' },
      { value: 'energy', label: 'Energy' },
      { value: 'loudness', label: 'Loudness' },
    ],
  },
]

/** The Camelot wheel in order, for the key picker. */
export const KEY_OPTIONS: readonly Option<string>[] = [
  ['1A', 'A♭ minor'],
  ['2A', 'E♭ minor'],
  ['3A', 'B♭ minor'],
  ['4A', 'F minor'],
  ['5A', 'C minor'],
  ['6A', 'G minor'],
  ['7A', 'D minor'],
  ['8A', 'A minor'],
  ['9A', 'E minor'],
  ['10A', 'B minor'],
  ['11A', 'F♯ minor'],
  ['12A', 'C♯ minor'],
  ['1B', 'B major'],
  ['2B', 'F♯ major'],
  ['3B', 'C♯ major'],
  ['4B', 'A♭ major'],
  ['5B', 'E♭ major'],
  ['6B', 'B♭ major'],
  ['7B', 'F major'],
  ['8B', 'C major'],
  ['9B', 'G major'],
  ['10B', 'D major'],
  ['11B', 'A major'],
  ['12B', 'E major'],
].map(([code, name]) => ({ value: code as string, label: `${code} · ${name}` }))

export const SORT_OPTIONS: readonly Option<SongSortField>[] = [
  { value: 'addedAt', label: 'Date added' },
  { value: 'title', label: 'Title' },
  { value: 'artist', label: 'Artist' },
  { value: 'album', label: 'Album' },
  { value: 'duration', label: 'Length' },
  { value: 'playCount', label: 'Play count' },
  { value: 'lastPlayedAt', label: 'Last played' },
  { value: 'random', label: 'Random' },
]

/** Every numeric field compares the same way, so the wording is shared. */
export const NUMBER_OPS = [
  { value: 'gt', label: 'is more than' },
  { value: 'gte', label: 'is at least' },
  { value: 'eq', label: 'is exactly' },
  { value: 'lte', label: 'is at most' },
  { value: 'lt', label: 'is less than' },
] as const

export const TEXT_OPS = [
  { value: 'contains', label: 'contains' },
  { value: 'notContains', label: 'does not contain' },
  { value: 'equals', label: 'is exactly' },
  { value: 'startsWith', label: 'starts with' },
] as const

export const TAG_OPS = [
  { value: 'has', label: 'is' },
  { value: 'notHas', label: 'is not' },
] as const

export const DATE_OPS = [
  { value: 'inLastDays', label: 'in the last' },
  { value: 'notInLastDays', label: 'not in the last' },
  { value: 'never', label: 'never' },
] as const

export const KEY_OPS = [
  { value: 'compatible', label: 'mixes with' },
  { value: 'is', label: 'is exactly' },
] as const

/** A sensible starting rule for each field, so adding one is never a dead end. */
export function defaultRuleFor(field: FieldKey, tags: readonly Pick<Tag, 'id'>[]): SmartRule {
  switch (field) {
    case 'title':
    case 'artist':
    case 'album':
    case 'albumArtist':
      return { field, op: 'contains', value: '' }
    case 'tag':
      return { field: 'tag', op: 'has', tagId: tags[0]?.id ?? 0 }
    case 'playCount':
    case 'skipCount':
    case 'duration':
    case 'year':
      return { field, op: 'gt', value: field === 'duration' ? 180 : 5 }
    case 'addedAt':
    case 'lastPlayedAt':
      return { field, op: 'inLastDays', days: 30 }
    case 'loved':
    case 'hasLyrics':
    case 'hasArt':
      return { field, op: 'is', value: true }
    case 'bpm':
      return { field, op: 'gte', value: 120 }
    case 'energy':
      return { field, op: 'gte', value: 0.6 }
    case 'loudness':
      return { field, op: 'gte', value: -12 }
    case 'key':
      return { field: 'key', op: 'compatible', value: '8A' }
  }
}

/** The word before a rule: the rules read as one sentence. */
export function joinWord(index: number, match: SmartRules['match']): string {
  if (index === 0) return 'Where'
  return match === 'all' ? 'and' : 'or'
}

/** The live count, in words, or what it is doing while there is no count. */
export function matchLabel(count: number | null): { number: string; text: string } {
  if (count === null) return { number: '', text: 'Checking…' }
  if (count === 0) return { number: '', text: 'Nothing matches yet' }
  return { number: count.toLocaleString('en-US'), text: count === 1 ? 'song matches' : 'songs match' }
}

/** The unit written after a number, where the number needs one. */
export function unitFor(field: FieldKey): string | null {
  switch (field) {
    case 'duration':
      return 'seconds'
    case 'bpm':
      return 'BPM'
    case 'energy':
      return '0–1'
    case 'loudness':
      return 'LUFS'
    case 'addedAt':
    case 'lastPlayedAt':
      return 'days'
    default:
      return null
  }
}
