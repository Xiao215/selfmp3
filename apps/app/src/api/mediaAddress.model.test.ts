import { describe, expect, it } from 'vitest'

import { artAddress, serverRoutes, streamAddress, type MediaRoutes } from './mediaAddress.model'

/** A browser's, as ports/bucketMedia.web.ts builds them: the app's own base path. */
const bucket: MediaRoutes = {
  stream: (songId, rev) =>
    rev ? `/selfmp3/api/stream/${songId}?v=${rev}` : `/selfmp3/api/stream/${songId}`,
  art: (songId, rev) =>
    rev ? `/selfmp3/api/art/${songId}?v=${rev}` : `/selfmp3/api/art/${songId}`,
}

/** A server's, through `createMediaUrl`: an absolute origin, with the token in the query. */
const server = serverRoutes(
  {
    stream: (songId, rev) => `http://mac:4600/api/stream/${songId}?v=${rev ?? ''}&token=t`,
    art: (songId, rev, size) =>
      `http://mac:4600/api/art/${songId}?v=${rev ?? ''}&size=${size ?? 0}`,
  },
  640,
)

describe('where a song plays from', () => {
  it('is the file on this device before anything else', () => {
    expect(
      streamAddress(12, 'r1', { local: 'file:///songs/12.m4a', bucket, server, fromCloud: true }),
    ).toBe('file:///songs/12.m4a')
    expect(
      streamAddress(12, 'r1', { local: 'file:///songs/12.m4a', bucket, server, fromCloud: false }),
    ).toBe('file:///songs/12.m4a')
  })

  it('is the app’s own address for a cloud library, so the service worker answers it', () => {
    expect(streamAddress(12, 'r1', { local: null, bucket, server: null, fromCloud: true })).toBe(
      '/selfmp3/api/stream/12?v=r1',
    )
  })

  it('carries the revision, which is how a replaced file defeats the cache', () => {
    expect(
      streamAddress(12, undefined, { local: null, bucket, server: null, fromCloud: true }),
    ).toBe('/selfmp3/api/stream/12')
  })

  it('never asks a server for a cloud library’s song, even one still connected', () => {
    expect(streamAddress(12, 'r1', { local: null, bucket, server, fromCloud: true })).toBe(
      '/selfmp3/api/stream/12?v=r1',
    )
  })

  it('is the server’s address for a server library, exactly as before', () => {
    expect(streamAddress(12, 'r1', { local: null, bucket, server, fromCloud: false })).toBe(
      'http://mac:4600/api/stream/12?v=r1&token=t',
    )
  })

  it('is nothing where this device has nowhere to play it from', () => {
    // A phone with a cloud library and no download: `bucketMedia` is null there,
    // and `playBlock` has already refused to play it.
    expect(streamAddress(12, 'r1', { local: null, bucket: null, server, fromCloud: true })).toBe('')
    // Signed out of everything.
    expect(
      streamAddress(12, 'r1', { local: null, bucket: null, server: null, fromCloud: false }),
    ).toBe('')
  })
})

describe('where a cover is drawn from', () => {
  it('is the app’s own address for a cloud library', () => {
    expect(artAddress(12, 'r1', { bucket, server, fromCloud: true })).toBe(
      '/selfmp3/api/art/12?v=r1',
    )
  })

  it('is the server’s, at the size covers are kept at, for a server library', () => {
    expect(artAddress(12, 'r1', { bucket, server, fromCloud: false })).toBe(
      'http://mac:4600/api/art/12?v=r1&size=640',
    )
  })

  it('is none on a platform that cannot serve the bucket’s picture', () => {
    expect(artAddress(12, 'r1', { bucket: null, server, fromCloud: true })).toBeNull()
  })

  it('asks a server for the original when no size is wanted', () => {
    const plain = serverRoutes({
      stream: songId => `http://mac:4600/api/stream/${songId}`,
      art: (songId, _rev, size) =>
        size === undefined ? `http://mac:4600/api/art/${songId}` : `sized/${size}`,
    })
    expect(artAddress(12, 'r1', { bucket, server: plain, fromCloud: false })).toBe(
      'http://mac:4600/api/art/12',
    )
  })
})
