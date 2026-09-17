import { EMPTY_SMART_RULES, type SmartRules } from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'

import { followedTagIds, hasRulesBeyondTags } from './follows.model'

const rules = (patch: Partial<SmartRules>): SmartRules => ({ ...EMPTY_SMART_RULES, ...patch })

describe('reading a playlist’s rules back as tags', () => {
  it('finds nothing in a playlist that follows nothing', () => {
    expect(followedTagIds(null)).toEqual([])
    expect(followedTagIds(EMPTY_SMART_RULES)).toEqual([])
  })

  it('keeps the tags in the order they were written', () => {
    const set = rules({
      rules: [
        { field: 'tag', op: 'has', tagId: 7 },
        { field: 'tag', op: 'has', tagId: 2 },
      ],
    })
    expect(followedTagIds(set)).toEqual([7, 2])
  })

  it('never lists a tag twice', () => {
    const set = rules({
      rules: [
        { field: 'tag', op: 'has', tagId: 3 },
        { field: 'tag', op: 'has', tagId: 3 },
      ],
    })
    expect(followedTagIds(set)).toEqual([3])
  })

  it('leaves out a rule the chips cannot show, rather than throwing at the reader', () => {
    const set = rules({
      rules: [
        { field: 'tag', op: 'has', tagId: 1 },
        { field: 'tag', op: 'notHas', tagId: 9 },
        { field: 'bpm', op: 'gt', value: 120 },
      ],
    })
    expect(followedTagIds(set)).toEqual([1])
  })
})

describe('noticing rules the row cannot draw', () => {
  it('says no for tags alone, and for nothing at all', () => {
    expect(hasRulesBeyondTags(null)).toBe(false)
    expect(hasRulesBeyondTags(rules({ rules: [{ field: 'tag', op: 'has', tagId: 1 }] }))).toBe(
      false,
    )
  })

  it('says yes for a condition that is not a tag, and for "not this tag"', () => {
    expect(hasRulesBeyondTags(rules({ rules: [{ field: 'loved', op: 'is', value: true }] }))).toBe(
      true,
    )
    expect(hasRulesBeyondTags(rules({ rules: [{ field: 'tag', op: 'notHas', tagId: 4 }] }))).toBe(
      true,
    )
  })
})
