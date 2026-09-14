import { describe, expect, it } from 'vitest'
import type { CloudSnapshot } from '@selfmp3/shared'
import { replay, replayedSnapshot } from './replay.js'

const base: CloudSnapshot = {
  format: 1,
  writtenAt: '2026-09-14T20:58:54.000Z',
  writtenBy: 'mac-3f9a1c2e',
  upTo: {},
  songs: [],
  tags: [],
  playlists: [],
  server: { addresses: ['http://localhost:4600', 'http://192.0.0.2:4600'], token: null },
}

describe('replayedSnapshot', () => {
  it('keeps where the server listens, which no change ever carries', () => {
    // The server published its addresses; the device showed "hasn't said where it
    // is" because the replayed snapshot was rebuilt without them.
    expect(replayedSnapshot(replay(base, [], []), base).server).toEqual(base.server)
  })

  it('has no addresses from a snapshot that named none, or from none at all', () => {
    const { server: _server, ...silent } = base
    expect(replayedSnapshot(replay(silent, [], []), silent).server).toBeUndefined()
    expect(replayedSnapshot(replay(null, [], []), null).server).toBeUndefined()
  })
})
