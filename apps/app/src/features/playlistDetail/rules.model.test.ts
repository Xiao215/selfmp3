import { SmartRuleSchema } from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'

import {
  defaultRuleFor,
  describeOrder,
  describeRule,
  FIELD_GROUPS,
  formatClock,
  joinWord,
  parseClock,
  KEY_OPTIONS,
  matchLabel,
  orderOptions,
  unitFor,
  type FieldKey,
} from './rules.model'

const TAGS = [{ id: 7 }, { id: 9 }]
const EVERY_FIELD: FieldKey[] = FIELD_GROUPS.flatMap(group => group.options.map(o => o.value))

describe('smart playlist rules', () => {
  it('offers every field the schema knows, once', () => {
    expect(new Set(EVERY_FIELD).size).toBe(EVERY_FIELD.length)
    expect(EVERY_FIELD).toHaveLength(18)
  })

  it('starts every field from a rule for that field', () => {
    for (const field of EVERY_FIELD) expect(defaultRuleFor(field, TAGS).field).toBe(field)
  })

  it('starts every non-text field from a rule the server will accept', () => {
    for (const field of EVERY_FIELD) {
      const rule = defaultRuleFor(field, TAGS)
      // A text rule starts empty, and becomes valid as soon as something is typed.
      if (['title', 'artist', 'album', 'albumArtist'].includes(field)) continue
      expect(SmartRuleSchema.safeParse(rule).success, field).toBe(true)
    }
  })

  it('picks the first tag, and the sensible numbers the web starts from', () => {
    expect(defaultRuleFor('tag', TAGS)).toEqual({ field: 'tag', op: 'has', tagId: 7 })
    expect(defaultRuleFor('duration', TAGS)).toEqual({ field: 'duration', op: 'gt', value: 180 })
    expect(defaultRuleFor('playCount', TAGS)).toEqual({ field: 'playCount', op: 'gt', value: 5 })
    expect(defaultRuleFor('key', TAGS)).toEqual({ field: 'key', op: 'compatible', value: '8A' })
  })

  it('reads the rules as a sentence', () => {
    expect(joinWord(0, 'all')).toBe('Where')
    expect(joinWord(1, 'all')).toBe('and')
    expect(joinWord(2, 'any')).toBe('or')
  })

  it('puts the count into words', () => {
    expect(matchLabel(null)).toEqual({ number: '', text: 'Checking…' })
    expect(matchLabel(0)).toEqual({ number: '', text: 'Nothing matches yet' })
    expect(matchLabel(1)).toEqual({ number: '1', text: 'song matches' })
    expect(matchLabel(1234)).toEqual({ number: '1,234', text: 'songs match' })
  })

  it('writes the unit after the numbers that need one', () => {
    expect(unitFor('duration')).toBe('m:ss')
    expect(unitFor('energy')).toBe('0–1')
    expect(unitFor('playCount')).toBeNull()
  })

  it('shows a length as a clock, and reads one typed either way', () => {
    expect(formatClock(210)).toBe('3:30')
    expect(formatClock(59.6)).toBe('1:00')
    expect(parseClock('3:30')).toBe(210)
    expect(parseClock('210')).toBe(210)
    // Half-typed is not a length yet, so nothing is saved from it.
    expect(parseClock('3:')).toBeNull()
    expect(parseClock('3:75')).toBeNull()
  })

  it('reads a rule back as words', () => {
    const tags = [{ id: 7, name: 'chill' }]
    expect(describeRule({ field: 'duration', op: 'gt', value: 210 }, tags)).toBe(
      'Length is more than 3:30',
    )
    expect(describeRule({ field: 'tag', op: 'has', tagId: 7 }, tags)).toBe('Tag is chill')
    expect(describeRule({ field: 'tag', op: 'has', tagId: 99 }, tags)).toBe('Tag is a deleted tag')
    expect(describeRule({ field: 'lastPlayedAt', op: 'notInLastDays', days: 30 }, tags)).toBe(
      'Last played not in the last 30 days',
    )
    expect(describeRule({ field: 'loved', op: 'is', value: true }, tags)).toBe('Loved')
    expect(describeRule({ field: 'artist', op: 'contains', value: 'YOASOBI' }, tags)).toBe(
      'Artist contains “YOASOBI”',
    )
  })

  it('reads the order back as words', () => {
    expect(describeOrder({ orderBy: 'duration', order: 'desc' })).toBe('longest first')
    expect(describeOrder({ orderBy: 'playCount', order: 'desc' })).toBe('most played first')
    expect(describeOrder({ orderBy: 'random', order: 'asc' })).toBe('in random order')
  })

  it('names the order the way the summary does, for the field being sorted', () => {
    const labels = (orderBy: Parameters<typeof orderOptions>[0]) =>
      orderOptions(orderBy).map(option => `${option.value}:${option.label}`)
    expect(labels('duration')).toEqual(['desc:Longest first', 'asc:Shortest first'])
    expect(labels('playCount')).toEqual(['desc:Most played', 'asc:Least played'])
    expect(labels('addedAt')).toEqual(['desc:Newest', 'asc:Oldest'])
    expect(labels('lastPlayedAt')).toEqual(['desc:Last played first', 'asc:Longest unplayed first'])
    expect(labels('title')).toEqual(['desc:Z–A', 'asc:A–Z'])
    // The summary agrees: descending by title is the one that says Z to A.
    expect(describeOrder({ orderBy: 'title', order: 'desc' })).toBe('by title, Z to A')
  })

  it('lists the Camelot wheel in order', () => {
    expect(KEY_OPTIONS).toHaveLength(24)
    expect(KEY_OPTIONS[7]).toEqual({ value: '8A', label: '8A · A minor' })
  })
})
