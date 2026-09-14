import { describe, expect, it } from 'vitest'
import { publishRefusedMessage, publishWouldLoseLibrary } from './cloudSnapshot.js'

/**
 * The server only ever writes snapshots, and the newest one in the bucket is what
 * every other device adopts. So a server that comes up holding less than the
 * bucket knows about would publish its own sparse database as the whole
 * library — which is what a reinstall, a restored backup, an unfinished first
 * scan, or another server on the same account all look like.
 */
describe('refusing to publish over a library', () => {
  it('refuses when most of the library would vanish', () => {
    expect(publishWouldLoseLibrary(400, 0)).toBe(true)
    expect(publishWouldLoseLibrary(400, 13)).toBe(true)
    expect(publishWouldLoseLibrary(400, 199)).toBe(true)
  })

  it('allows a library that grew, or barely changed', () => {
    expect(publishWouldLoseLibrary(400, 400)).toBe(false)
    expect(publishWouldLoseLibrary(400, 401)).toBe(false)
    expect(publishWouldLoseLibrary(400, 380)).toBe(false)
    // Exactly half is the edge, and it is allowed: the rule is "more than".
    expect(publishWouldLoseLibrary(400, 200)).toBe(false)
  })

  it('keeps quiet about libraries too small to be sure about', () => {
    // At this size "half of them are gone" is one or two deleted songs, and
    // refusing would be noise rather than protection.
    expect(publishWouldLoseLibrary(7, 0)).toBe(false)
    expect(publishWouldLoseLibrary(2, 1)).toBe(false)
  })

  it('allows the first publish into an empty bucket', () => {
    // Nothing to lose is not a reason to refuse; it is the normal first run.
    expect(publishWouldLoseLibrary(0, 0)).toBe(false)
    expect(publishWouldLoseLibrary(0, 500)).toBe(false)
  })

  it('says both numbers and how to override, since it is blocking sync', () => {
    const said = publishRefusedMessage(400, 13)
    expect(said).toContain('400')
    expect(said).toContain('13')
    expect(said).toContain('SELFMP3_PUBLISH_ANYWAY')
  })
})
