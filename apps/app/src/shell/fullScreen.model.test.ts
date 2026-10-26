import { describe, expect, it } from 'vitest'
import { opensSignedOut } from './fullScreen.model'

describe('opensSignedOut', () => {
  it('opens a room’s invite, the room, a share link and a shared playlist’s invite', () => {
    for (const path of ['/join/KQ7482', '/room', '/l/abc/def', '/shared/abc/join/def']) {
      expect(opensSignedOut(path), path).toBe(true)
    }
    expect(opensSignedOut('/library')).toBe(false)
  })

  it('opens Search only for a guest in a room, where it adds to the room', () => {
    expect(opensSignedOut('/search')).toBe(false)
    expect(opensSignedOut('/search', true)).toBe(true)
    expect(opensSignedOut('/library', true)).toBe(false)
  })
})
