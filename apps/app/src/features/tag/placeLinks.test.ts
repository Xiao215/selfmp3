import { describe, expect, it } from 'vitest'

import { artistLink, placeParam, tagLink } from './placeLinks'

describe('a place’s name in its address', () => {
  it('is the name itself for nearly every name', () => {
    for (const name of ['night drive', 'a/b', '#1', 'what?', 'a&b=c', '中文', '...and more']) {
      expect(placeParam(name)).toBe(name)
    }
  })

  it('carries a percent sign through the decode the screen’s params get', () => {
    expect(placeParam('100%')).toBe('100%25')
    expect(decodeURIComponent(placeParam('%2F'))).toBe('%2F')
  })

  it('never makes a step the browser takes, for a name of only dots', () => {
    expect(placeParam('..')).toBe('%2E%2E')
    expect(placeParam('.')).toBe('%2E')
    expect(decodeURIComponent(placeParam('..'))).toBe('..')
  })

  it('is what a tag’s and an artist’s link carry', () => {
    expect(tagLink('..').params.name).toBe('%2E%2E')
    expect(artistLink('100%').params.name).toBe('100%25')
  })
})
