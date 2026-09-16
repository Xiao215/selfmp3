import { describe, expect, it } from 'vitest'
import { gzipSync } from 'node:zlib'
import {
  publishRefusedMessage,
  publishWouldLoseLibrary,
  snapshotSongCount,
} from './cloudSnapshot.js'

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

/**
 * Reading the bucket's newest snapshot, which is the half that was missing.
 *
 * The rule above was right and unit-tested from the day it was written; the
 * guard that used it published over a real library anyway, because it could
 * never read the snapshot it was comparing against. It decompressed every body
 * it was handed, Node's fetch had already decompressed that body by its
 * `Content-Encoding`, the throw landed in a catch that meant "never mind", and
 * a 52-song library was replaced by a 1-song one with nothing said.
 */
describe('reading a snapshot back', () => {
  const snapshot = (count: number): Buffer =>
    Buffer.from(
      JSON.stringify({ songs: Array.from({ length: count }, (_, i) => ({ uid: `s${i}` })) }),
    )

  it('reads one that arrives gzipped, as the bucket stores it', () => {
    expect(snapshotSongCount(gzipSync(snapshot(52)))).toBe(52)
  })

  it('reads one that arrives already decoded, as fetch hands it over', () => {
    expect(snapshotSongCount(snapshot(52))).toBe(52)
  })

  it('reads an empty library as empty rather than as unreadable', () => {
    expect(snapshotSongCount(snapshot(0))).toBe(0)
    expect(snapshotSongCount(gzipSync(snapshot(0)))).toBe(0)
  })

  it('throws on anything that is not a snapshot, so a caller cannot read it as zero', () => {
    // Zero would be the dangerous answer: it is exactly the count that lets a
    // fresh server publish over everything.
    expect(() => snapshotSongCount(Buffer.from('<html>not your bucket</html>'))).toThrow()
    expect(() => snapshotSongCount(Buffer.from('{"songs":"lots"}'))).toThrow()
    expect(() => snapshotSongCount(Buffer.from(''))).toThrow()
  })

  it('still refuses once the count it reads is compared', () => {
    // The end-to-end shape of what happened: 52 in the bucket, 1 here.
    const inBucket = snapshotSongCount(gzipSync(snapshot(52)))
    expect(publishWouldLoseLibrary(inBucket, 1)).toBe(true)
  })
})
