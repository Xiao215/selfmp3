import { parseShareStart } from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'
import { shareLinkUrl } from './shareApi.js'

/** A share link's address, and the start it carries when shared from a line. */
describe('a share link’s address', () => {
  const link = { id: '0123456789abcdef', key: 'fedcba9876543210' }

  it('is the link’s page, with no start unless it was shared from a line', () => {
    expect(shareLinkUrl('https://app.example/', link)).toBe(
      'https://app.example/l/0123456789abcdef/fedcba9876543210',
    )
    expect(shareLinkUrl('https://app.example', link, 42.9)).toBe(
      'https://app.example/l/0123456789abcdef/fedcba9876543210?t=0:42',
    )
    expect(shareLinkUrl('', link, 3723)).toBe('/l/0123456789abcdef/fedcba9876543210?t=1:02:03')
  })

  it('carries a start that reads back as the same time', () => {
    for (const at of [0, 42, 599, 3600, 3723]) {
      const t = new URL(shareLinkUrl('https://app.example', link, at)).searchParams.get('t')
      expect(parseShareStart(t)).toBe(at)
    }
  })
})
