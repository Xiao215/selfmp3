import { parseShareStart } from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'
import { shareLinkUrl } from './shareApi.js'

/** A share link's address, the song a list opens on, and the start a line gives it. */
describe('a share link’s address', () => {
  const link = { id: '0123456789abcdef', key: 'fedcba9876543210' }

  it('is the link’s page, with no start unless it was shared from a line', () => {
    expect(shareLinkUrl('https://app.example/', link)).toBe(
      'https://app.example/l/0123456789abcdef/fedcba9876543210',
    )
    expect(shareLinkUrl('https://app.example', link, { start: 42.9 })).toBe(
      'https://app.example/l/0123456789abcdef/fedcba9876543210?t=0:42',
    )
    expect(shareLinkUrl('', link, { start: 3723 })).toBe(
      '/l/0123456789abcdef/fedcba9876543210?t=1:02:03',
    )
  })

  it('names the song a list opens on', () => {
    expect(shareLinkUrl('', link, { song: 'a1b2c3d4e5f6' })).toBe(
      '/l/0123456789abcdef/fedcba9876543210?s=a1b2c3d4e5f6',
    )
    expect(shareLinkUrl('', link, { song: 'a1b2c3d4e5f6', start: 42 })).toBe(
      '/l/0123456789abcdef/fedcba9876543210?s=a1b2c3d4e5f6&t=0:42',
    )
  })

  it('carries a start that reads back as the same time', () => {
    for (const at of [0, 42, 599, 3600, 3723]) {
      const t = new URL(shareLinkUrl('https://app.example', link, { start: at })).searchParams.get(
        't',
      )
      expect(parseShareStart(t)).toBe(at)
    }
  })
})
