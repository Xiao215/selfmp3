import { describe, expect, it } from 'vitest'

import { existingTag, songCount, tagsHeadline, tagsToManage } from './tags.model'

describe('the Tags page', () => {
  it('finds a tag by name before making a second one', () => {
    const tags = [
      { id: 1, name: 'YOASOBI' },
      { id: 2, name: 'study' },
    ]
    expect(existingTag(tags, ' yoasobi ')?.id).toBe(1)
    expect(existingTag(tags, 'chill')).toBeNull()
    expect(existingTag(tags, '  ')).toBeNull()
  })

  it('counts songs in words', () => {
    expect(songCount(1)).toBe('1 song')
    expect(songCount(15)).toBe('15 songs')
  })

  it('lists the tags carrying the most first, ties by name', () => {
    const tags = [
      { name: 'sad', songCount: 2 },
      { name: 'chill', songCount: 23 },
      { name: 'road trip', songCount: 2 },
      { name: 'hype', songCount: 15 },
    ]
    expect(tagsToManage(tags).map(tag => tag.name)).toEqual(['chill', 'hype', 'road trip', 'sad'])
    // A library collects tags that are on one song each; alphabetical would
    // put those first and the tag worth renaming carefully last.
    expect(tagsToManage(tags)[0]?.songCount).toBe(23)
  })

  it('lets a search do the ordering instead', () => {
    const tags = [
      { name: 'chill', songCount: 23 },
      { name: 'karaoke', songCount: 3 },
    ]
    expect(tagsToManage(tags, ' kara ').map(tag => tag.name)).toEqual(['karaoke'])
    expect(tagsToManage(tags, '   ').map(tag => tag.name)).toEqual(['chill', 'karaoke'])
  })

  it('says how many tags there are, and when there are none', () => {
    expect(tagsHeadline(0)).toBe('No tags yet')
    expect(tagsHeadline(1)).toBe('1 tag')
    expect(tagsHeadline(9)).toBe('9 tags')
  })
})
