import { describe, expect, it } from 'vitest'

import { tagsHeadline } from './tags.model'

describe('All tags', () => {
  it('says how many tags there are and in what order, and when there are none', () => {
    expect(tagsHeadline(0)).toBe('No tags yet')
    expect(tagsHeadline(1)).toBe('1 tag · most played first')
    expect(tagsHeadline(8)).toBe('8 tags · most played first')
  })
})
