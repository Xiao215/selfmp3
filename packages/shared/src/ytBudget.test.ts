import { describe, expect, it } from 'vitest'
import { youtubeAddressOf } from './ytBudget.js'

describe('youtubeAddressOf', () => {
  it('reads the address YouTube gave a media link to', () => {
    expect(
      youtubeAddressOf(
        'https://rr4---sn-a5meknzr.googlevideo.com/videoplayback?expire=1&ip=104.133.198.141&id=o',
      ),
    ).toBe('104.133.198.141')
    expect(
      youtubeAddressOf(
        'https://rr1---sn-x.googlevideo.com/videoplayback?ip=2601%3A647%3A6800%3A%3A1',
      ),
    ).toBe('2601:647:6800::1')
  })

  it('says nothing of a link that is not YouTube’s media, or names no address', () => {
    expect(youtubeAddressOf('https://www.youtube.com/watch?v=dQw4w9WgXcQ&ip=1.2.3.4')).toBeNull()
    expect(youtubeAddressOf('https://evil.test/googlevideo.com?ip=1.2.3.4')).toBeNull()
    expect(youtubeAddressOf('https://rr1---sn-x.googlevideo.com/videoplayback')).toBeNull()
    expect(
      youtubeAddressOf('https://rr1---sn-x.googlevideo.com/videoplayback?ip=<script>'),
    ).toBeNull()
    expect(youtubeAddressOf('not a link')).toBeNull()
  })
})
