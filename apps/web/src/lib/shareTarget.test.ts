import { describe, expect, it } from 'vitest'
import { sharedLinksFromQuery } from './shareTarget.js'

describe('sharedLinksFromQuery', () => {
  it('reads a plain url param', () => {
    expect(sharedLinksFromQuery('?url=https%3A%2F%2Fyoutu.be%2FdQw4w9WgXcQ')).toBe(
      'https://youtu.be/dQw4w9WgXcQ',
    )
  })

  it('digs the link out of text the YouTube app shares', () => {
    const search =
      '?title=Never%20Gonna%20Give%20You%20Up&text=Never%20Gonna%20Give%20You%20Up%20https%3A%2F%2Fyoutu.be%2FdQw4w9WgXcQ%3Fsi%3Dabc'
    expect(sharedLinksFromQuery(search)).toBe('https://youtu.be/dQw4w9WgXcQ?si=abc')
  })

  it('merges url and text without duplicating', () => {
    const search =
      '?url=https%3A%2F%2Fa.example%2Fx&text=https%3A%2F%2Fa.example%2Fx%20https%3A%2F%2Fb.example%2Fy'
    expect(sharedLinksFromQuery(search)).toBe('https://a.example/x\nhttps://b.example/y')
  })

  it('returns null when nothing shareable arrived', () => {
    expect(sharedLinksFromQuery('')).toBeNull()
    expect(sharedLinksFromQuery('?q=chill')).toBeNull()
    expect(sharedLinksFromQuery('?text=just%20some%20words')).toBeNull()
  })
})
