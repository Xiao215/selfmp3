import { DEFAULT_FILTER } from '@selfmp3/client'
import { describe, expect, it } from 'vitest'

import { existingTag, onlyTag, songCount } from './tags.model'

describe('the Tags page', () => {
  it('shows one tag’s songs, whatever was filtering before', () => {
    const before = {
      ...DEFAULT_FILTER,
      query: 'idol',
      includedTagIds: [1, 2],
      excludedTagIds: [7],
      sort: 'title' as const,
      downloadedOnly: true,
    }
    expect(onlyTag(before, 7)).toEqual({
      ...before,
      query: '',
      includedTagIds: [7],
      excludedTagIds: [],
    })
  })

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
