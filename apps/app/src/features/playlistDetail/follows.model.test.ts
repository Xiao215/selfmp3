import { EMPTY_SMART_RULES, type SmartRules } from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'

import { followedTagIds, withFollowedTags } from './follows.model'

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

describe('changing the chips of a live playlist', () => {
  // The real library's case: a length rule with tags, all of which must hold,
  // longest first, fifty at most.
  const long: SmartRules = {
    match: 'all',
    rules: [
      { field: 'duration', op: 'gt', value: 300 },
      { field: 'tag', op: 'has', tagId: 1 },
      { field: 'tag', op: 'has', tagId: 2 },
    ],
    orderBy: 'duration',
    order: 'asc',
    limit: 50,
  }

  it('adds a chip at the end and keeps the length rule, match, order and limit', () => {
    expect(withFollowedTags(long, [1, 2, 5])).toEqual({
      ...long,
      rules: [...long.rules, { field: 'tag', op: 'has', tagId: 5 }],
    })
  })

  it('removes a chip and only that rule', () => {
    expect(withFollowedTags(long, [2])).toEqual({
      ...long,
      rules: [
        { field: 'duration', op: 'gt', value: 300 },
        { field: 'tag', op: 'has', tagId: 2 },
      ],
    })
  })

  it('adds and removes in one edit, the rule it cannot draw staying where it was', () => {
    const next = withFollowedTags(long, [2, 7])
    expect(next.rules).toEqual([
      { field: 'duration', op: 'gt', value: 300 },
      { field: 'tag', op: 'has', tagId: 2 },
      { field: 'tag', op: 'has', tagId: 7 },
    ])
    expect(followedTagIds(next)).toEqual([2, 7])
    expect(next).toMatchObject({ match: 'all', orderBy: 'duration', order: 'asc', limit: 50 })
  })

  it('leaves every rule alone when the chips are what they were', () => {
    expect(withFollowedTags(long, [1, 2])).toEqual(long)
  })

  it('keeps "not this tag" even for a tag chosen as a chip, and writes a repeated tag once', () => {
    const set = rules({
      match: 'any',
      rules: [
        { field: 'tag', op: 'notHas', tagId: 4 },
        { field: 'tag', op: 'has', tagId: 3 },
        { field: 'loved', op: 'is', value: true },
        { field: 'tag', op: 'has', tagId: 3 },
      ],
    })
    expect(withFollowedTags(set, [3, 4]).rules).toEqual([
      { field: 'tag', op: 'notHas', tagId: 4 },
      { field: 'tag', op: 'has', tagId: 3 },
      { field: 'loved', op: 'is', value: true },
      { field: 'tag', op: 'has', tagId: 4 },
    ])
  })
})
