import { describe, expect, it } from 'vitest'
import { importable, pageKind } from './pageKind.js'

describe('pageKind', () => {
  it('reads a song from every form of video link', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=ZRtdQ81jPUQ',
      'https://music.youtube.com/watch?v=ZRtdQ81jPUQ&list=RDAMVMZRtdQ81jPUQ',
      'https://youtu.be/ZRtdQ81jPUQ',
      'https://m.youtube.com/watch?v=ZRtdQ81jPUQ',
    ]) {
      expect(pageKind(url), url).toEqual({ kind: 'song', videoId: 'ZRtdQ81jPUQ' })
    }
  })

  it('tells playlists, albums, artists and searches apart', () => {
    expect(
      pageKind('https://www.youtube.com/playlist?list=PLgf-8GQFjABq2XqYIaYD4C_uIZ4jLL4x-').kind,
    ).toBe('playlist')
    expect(pageKind('https://music.youtube.com/playlist?list=LM').kind).toBe('playlist')
    // YouTube Music opens an album's browse link as its OLAK5uy_ playlist.
    expect(pageKind('https://music.youtube.com/playlist?list=OLAK5uy_kZ3').kind).toBe('album')
    expect(pageKind('https://music.youtube.com/browse/MPREb_hqiB0KumHYT').kind).toBe('album')
    expect(pageKind('https://www.youtube.com/@YOASOBI_Official').kind).toBe('artist')
    expect(pageKind('https://music.youtube.com/search?q=yoasobi').kind).toBe('search')
  })

  it('has nothing to import anywhere else', () => {
    for (const url of [
      null,
      'https://www.youtube.com/',
      'https://www.youtube.com/results?search_query=yoasobi',
      'https://example.com/watch?v=ZRtdQ81jPUQ',
      'chrome://extensions',
    ]) {
      expect(importable(pageKind(url)), String(url)).toBe(false)
    }
  })
})
