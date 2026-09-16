import { describe, expect, it } from 'vitest'
import { CloudSnapshotSchema, migrateCloudSnapshot } from './cloud.js'

/**
 * Reading a snapshot written by a build that is not this one.
 *
 * A bucket keeps snapshots for as long as the library exists, written by
 * whichever version was running that afternoon, and every device reads the
 * newest it finds. So a field renamed in the code is not renamed in the bucket
 * until the next publish — and until then the old name is what the library is
 * actually called.
 *
 * `features` became `audioFeatures` on 2026-09-14 at 21:22. A real library
 * published at 18:29 that same day became unreadable to everything built after
 * it: the server declined to publish over a library it could not parse, and the
 * app threw. Both were looking at a perfectly good snapshot.
 */

const FEATURES = {
  bpm: 128,
  energy: 0.7,
  loudnessLufs: -9.2,
  key: 'A minor',
  camelot: '8A',
  danceability: 0.6,
  analyzedAt: '2026-09-14T00:00:00.000Z',
  version: 1,
}

const song = (extra: Record<string, unknown>): Record<string, unknown> => ({
  uid: '0123456789abcdef0123456789abcdef',
  title: 'Sunrise',
  artist: 'Someone',
  album: '',
  albumArtist: '',
  trackNo: null,
  year: null,
  duration: 210,
  audio: { key: `audio/${'a'.repeat(64)}.m4a`, size: 1, mime: 'audio/mp4' },
  cover: null,
  lyrics: null,
  instrumental: false,
  loved: false,
  playCount: 0,
  skipCount: 0,
  lastPlayedAt: null,
  addedAt: '2026-09-14T00:00:00.000Z',
  sourceUrl: null,
  tagUids: [],
  ...extra,
})

const snapshotOf = (songs: unknown[]): Record<string, unknown> => ({
  format: 1,
  writtenAt: '2026-09-14T18:29:05.507Z',
  writtenBy: 'mac-b7961843',
  songs,
  tags: [],
  playlists: [],
})

describe('migrateCloudSnapshot', () => {
  it('reads a library published under the old field name', () => {
    const raw = snapshotOf([song({ features: FEATURES })])
    const parsed = CloudSnapshotSchema.parse(migrateCloudSnapshot(raw))
    expect(parsed.songs[0]?.audioFeatures).toEqual(FEATURES)
  })

  it('reads one published before the field existed at all', () => {
    const parsed = CloudSnapshotSchema.parse(migrateCloudSnapshot(snapshotOf([song({})])))
    expect(parsed.songs[0]?.audioFeatures).toBeNull()
  })

  it('leaves a snapshot written by this build alone', () => {
    const raw = snapshotOf([song({ audioFeatures: FEATURES })])
    expect(CloudSnapshotSchema.parse(migrateCloudSnapshot(raw)).songs[0]?.audioFeatures).toEqual(
      FEATURES,
    )
  })

  it('prefers the new name when a snapshot somehow carries both', () => {
    const raw = snapshotOf([song({ audioFeatures: FEATURES, features: { ...FEATURES, bpm: 90 } })])
    expect(CloudSnapshotSchema.parse(migrateCloudSnapshot(raw)).songs[0]?.audioFeatures?.bpm).toBe(
      128,
    )
  })

  it('hands back anything that is not a snapshot untouched', () => {
    // It runs before parsing, so it is handed whatever the bucket returned.
    expect(migrateCloudSnapshot(null)).toBeNull()
    expect(migrateCloudSnapshot('<html>a proxy login page</html>')).toBe(
      '<html>a proxy login page</html>',
    )
    expect(migrateCloudSnapshot({ songs: 'lots' })).toEqual({ songs: 'lots' })
  })

  it('is what keeps the analysis, rather than merely what stops the throw', () => {
    // Making the field default to null is enough to parse an old snapshot, and
    // that alone would have been the wrong fix: every song's key, tempo and
    // loudness would be read as "never analysed" and the next publish would
    // write that back. The migration is the half that keeps the library.
    const raw = snapshotOf([song({ features: FEATURES })])
    expect(CloudSnapshotSchema.parse(raw).songs[0]?.audioFeatures).toBeNull()
    expect(CloudSnapshotSchema.parse(migrateCloudSnapshot(raw)).songs[0]?.audioFeatures).toEqual(
      FEATURES,
    )
  })
})
