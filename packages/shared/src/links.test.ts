import { describe, expect, it } from 'vitest'
import { extractUrls, isYouTubeUrl } from './links.js'

describe('extractUrls', () => {
  it('finds one link per line', () => {
    expect(extractUrls('https://a.example/one\n  https://b.example/two  \n')).toEqual([
      'https://a.example/one',
      'https://b.example/two',
    ])
  })

  it('pulls links out of shared free text and strips trailing punctuation', () => {
    const text =
      'Check this out: https://youtu.be/dQw4w9WgXcQ. Also https://music.youtube.com/watch?v=abc&list=x)'
    expect(extractUrls(text)).toEqual([
      'https://youtu.be/dQw4w9WgXcQ',
      'https://music.youtube.com/watch?v=abc&list=x',
    ])
  })

  it('ignores non-http schemes and junk', () => {
    expect(extractUrls('ftp://x.example/y not a link www.example.com')).toEqual([])
  })

  it('de-duplicates and caps', () => {
    expect(extractUrls('https://x.example/a https://x.example/a')).toEqual(['https://x.example/a'])
    const many = Array.from({ length: 30 }, (_, i) => `https://x.example/${i}`).join(' ')
    expect(extractUrls(many)).toHaveLength(20)
    expect(extractUrls(many, 3)).toHaveLength(3)
  })
})

describe('isYouTubeUrl', () => {
  it('recognises the YouTube hosts', () => {
    expect(isYouTubeUrl('https://music.youtube.com/playlist?list=LM')).toBe(true)
    expect(isYouTubeUrl('https://www.youtube.com/watch?v=x')).toBe(true)
    expect(isYouTubeUrl('https://youtu.be/x')).toBe(true)
    expect(isYouTubeUrl('https://soundcloud.com/x')).toBe(false)
    expect(isYouTubeUrl('nope')).toBe(false)
  })
})
