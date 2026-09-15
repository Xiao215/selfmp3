import { describe, expect, it } from 'vitest'
import { linkFrom } from './menus.js'

describe('linkFrom', () => {
  it('takes the link that was right-clicked', () => {
    expect(
      linkFrom({
        linkUrl: 'https://youtu.be/ZRtdQ81jPUQ',
        pageUrl: 'https://www.reddit.com/r/music',
      }),
    ).toBe('https://youtu.be/ZRtdQ81jPUQ')
  })

  it('finds a link inside selected text', () => {
    expect(
      linkFrom({ selectionText: 'this one https://music.youtube.com/watch?v=x is good' }),
    ).toBe('https://music.youtube.com/watch?v=x')
  })

  it('falls back to the page itself, and gives up when there is nothing', () => {
    expect(linkFrom({ pageUrl: 'https://www.youtube.com/watch?v=ZRtdQ81jPUQ' })).toBe(
      'https://www.youtube.com/watch?v=ZRtdQ81jPUQ',
    )
    expect(linkFrom({ selectionText: 'no link here' })).toBeNull()
    expect(linkFrom({})).toBeNull()
  })
})
