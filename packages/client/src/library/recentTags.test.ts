import type { Tag } from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'

import {
  chooserTagGroups,
  parseRecentTagIds,
  railTags,
  serialiseRecentTagIds,
  withTagUsed,
} from './recentTags.js'

const tag = (id: number, name: string, songCount: number): Tag => ({
  id,
  name,
  hue: 200,
  songCount,
})

const TAGS = [
  tag(1, 'chill', 142),
  tag(2, 'chinese', 96),
  tag(3, 'hype', 71),
  tag(4, 'study', 54),
  tag(5, 'rain', 12),
]

describe('remembering which tags were used', () => {
  it('puts a used tag first, and only once', () => {
    expect(withTagUsed([3, 1, 2], 1)).toEqual([1, 3, 2])
    expect(withTagUsed([], 4)).toEqual([4])
  })

  it('forgets the oldest once it is full', () => {
    const many = Array.from({ length: 12 }, (_, index) => index + 1)
    const next = withTagUsed(many, 99)
    expect(next).toHaveLength(12)
    expect(next[0]).toBe(99)
    expect(next).not.toContain(12)
  })

  it('survives a stored value that is not a list of ids', () => {
    expect(parseRecentTagIds(null)).toEqual([])
    expect(parseRecentTagIds('')).toEqual([])
    expect(parseRecentTagIds('not json')).toEqual([])
    expect(parseRecentTagIds('{"a":1}')).toEqual([])
    expect(parseRecentTagIds('[1,"two",null,3,-4,2.5]')).toEqual([1, 3])
  })

  it('round-trips', () => {
    expect(parseRecentTagIds(serialiseRecentTagIds([5, 2, 9]))).toEqual([5, 2, 9])
  })
})

describe('the tags the rail shows', () => {
  it('starts as the biggest tags when nothing has been used', () => {
    expect(railTags([], TAGS).map(t => t.name)).toEqual(['chill', 'chinese', 'hype', 'study'])
  })

  it('leads with what was used, and fills the rest with the biggest', () => {
    expect(railTags([5], TAGS).map(t => t.name)).toEqual(['rain', 'chill', 'chinese', 'hype'])
  })

  it('never shows a tag twice', () => {
    const names = railTags([1, 5, 1], TAGS).map(t => t.name)
    expect(names).toEqual(['chill', 'rain', 'chinese', 'hype'])
  })

  it('skips a remembered tag that has since been deleted', () => {
    expect(railTags([99, 5], TAGS).map(t => t.name)).toEqual(['rain', 'chill', 'chinese', 'hype'])
  })

  it('shows every tag there is when there are fewer than four', () => {
    expect(railTags([], TAGS.slice(0, 2)).map(t => t.name)).toEqual(['chill', 'chinese'])
  })
})

describe('the rows the tag chooser offers', () => {
  const many = Array.from({ length: 20 }, (_, index) =>
    tag(index + 1, `tag${index + 1}`, 100 - index),
  )

  it('offers the twelve biggest, then the newest that are not already shown', () => {
    const { mostUsed, lately } = chooserTagGroups(many, [])
    expect(mostUsed).toHaveLength(12)
    expect(mostUsed[0]?.name).toBe('tag1')
    // 13–20 are left; the newest four of those are the highest ids.
    expect(lately.map(t => t.name)).toEqual(['tag20', 'tag19', 'tag18', 'tag17'])
  })

  it('never shows a tag in both rows', () => {
    const { mostUsed, lately } = chooserTagGroups(many, [])
    const ids = new Set(mostUsed.map(t => t.id))
    expect(lately.some(t => ids.has(t.id))).toBe(false)
  })

  it('pulls a chosen tag into view when it would be in neither row', () => {
    const buried = many.find(t => t.name === 'tag15')!
    const { mostUsed } = chooserTagGroups(many, [buried.id])
    expect(mostUsed[0]?.name).toBe('tag15')
  })

  it('leaves a chosen tag where it is when it is already shown', () => {
    const { mostUsed } = chooserTagGroups(many, [many[3]!.id])
    expect(mostUsed.map(t => t.name).slice(0, 4)).toEqual(['tag1', 'tag2', 'tag3', 'tag4'])
  })

  it('copes with a library that has no tags', () => {
    expect(chooserTagGroups([], [])).toEqual({ mostUsed: [], lately: [] })
  })
})
