import { describe, expect, it } from 'vitest'
import { describeUserAgent } from './device.js'

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.6422.80 Mobile/15E148 Safari/604.1'
const MAC_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36'
const WINDOWS_EDGE =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0'

describe('describeUserAgent', () => {
  it('names phones and browsers', () => {
    expect(describeUserAgent(IPHONE_SAFARI)).toEqual({ name: 'iPhone · Safari', kind: 'phone' })
    expect(describeUserAgent(IPHONE_CHROME)).toEqual({ name: 'iPhone · Chrome', kind: 'phone' })
    expect(describeUserAgent(ANDROID_CHROME)).toEqual({
      name: 'Android phone · Chrome',
      kind: 'phone',
    })
  })

  it('names desktops and does not mistake Chrome for Safari', () => {
    expect(describeUserAgent(MAC_CHROME)).toEqual({ name: 'Mac · Chrome', kind: 'desktop' })
    expect(describeUserAgent(MAC_SAFARI)).toEqual({ name: 'Mac · Safari', kind: 'desktop' })
    expect(describeUserAgent(WINDOWS_EDGE)).toEqual({ name: 'Windows PC · Edge', kind: 'desktop' })
  })

  it('tells an iPad apart from a Mac by touch', () => {
    expect(describeUserAgent(MAC_SAFARI, 5)).toEqual({ name: 'iPad · Safari', kind: 'other' })
  })

  it('falls back gracefully on something unknown', () => {
    expect(describeUserAgent('curl/8.0')).toEqual({ name: 'Device · Browser', kind: 'other' })
  })
})
