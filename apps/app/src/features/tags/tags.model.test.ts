import { describe, expect, it } from 'vitest'

import { existingTag, songCount } from './tags.model'

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
})
