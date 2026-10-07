import { describe, expect, it } from 'vitest'
import { isPendingRequest, sameLink } from './schemas.js'

describe('sameLink', () => {
  it('matches one video whatever form each link takes', () => {
    expect(
      sameLink(
        'https://youtu.be/ZRtdQ81jPUQ',
        'https://music.youtube.com/watch?v=ZRtdQ81jPUQ&list=RDAMVM',
      ),
    ).toBe(true)
    expect(
      sameLink('https://youtu.be/ZRtdQ81jPUQ', 'https://www.youtube.com/watch?v=jNQXAC9IVRw'),
    ).toBe(false)
  })

  it('compares any other link as it is', () => {
    expect(sameLink('https://example.com/a', 'https://example.com/a')).toBe(true)
    expect(sameLink('https://example.com/a', 'https://example.com/b')).toBe(false)
  })
})

describe('isPendingRequest', () => {
  it('is a request the server has not finished with', () => {
    expect(isPendingRequest({ state: 'waiting' })).toBe(true)
    expect(isPendingRequest({ state: 'working' })).toBe(true)
    expect(isPendingRequest({ state: 'done' })).toBe(false)
    expect(isPendingRequest({ state: 'cancelled' })).toBe(false)
  })
})
