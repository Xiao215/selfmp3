import { SmartRuleSchema } from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'

import {
  defaultRuleFor,
  FIELD_GROUPS,
  joinWord,
  KEY_OPTIONS,
  matchLabel,
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
    expect(unitFor('duration')).toBe('seconds')
    expect(unitFor('energy')).toBe('0–1')
    expect(unitFor('playCount')).toBeNull()
  })

  it('lists the Camelot wheel in order', () => {
    expect(KEY_OPTIONS).toHaveLength(24)
    expect(KEY_OPTIONS[7]).toEqual({ value: '8A', label: '8A · A minor' })
  })
})
