import { describe, expect, it } from 'vitest'
import { isSquareCoverUrl } from './coverArt.js'

describe('isSquareCoverUrl', () => {
  it('knows a square by the size its address asks for', () => {
    expect(isSquareCoverUrl('https://lh3.googleusercontent.com/abc=w544-h544-l90-rj')).toBe(true)
    expect(isSquareCoverUrl('https://lh3.googleusercontent.com/abc=s576')).toBe(true)
    expect(isSquareCoverUrl('https://p2.music.126.net/a==/1.jpg?param=1000y1000')).toBe(true)
  })

  it('does not take a video still, or an odd size, for one', () => {
    expect(isSquareCoverUrl('https://i.ytimg.com/vi/abc/hqdefault.jpg')).toBe(false)
    expect(isSquareCoverUrl('https://p2.music.126.net/a==/1.jpg?param=1000y500')).toBe(false)
    expect(isSquareCoverUrl('https://p2.music.126.net/a==/1.jpg')).toBe(false)
    expect(isSquareCoverUrl(null)).toBe(false)
  })
})
