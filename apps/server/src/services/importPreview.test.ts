import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { EMPTY_SMART_RULES } from '@selfmp3/shared'
import { migrate } from '../db/migrate.js'
import { createLogger } from '../logger.js'
import { PlaylistRepository } from '../repositories/playlists.js'
import { resolveImportPlaylist } from './importPreview.js'

/** The real schema on an in-memory database, the same way smartPlaylist.test does. */
function makePlaylists(): PlaylistRepository {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrate(db, createLogger('silent'))
  return new PlaylistRepository(db)
}

describe('resolveImportPlaylist', () => {
  it('returns null when nothing was asked for', () => {
    const playlists = makePlaylists()
    expect(resolveImportPlaylist(playlists, { playlistId: null, createPlaylistName: null })).toBe(
      null,
    )
    expect(playlists.all()).toHaveLength(0)
  })

  it('creates a manual playlist by name, and reuses it next time', () => {
    const playlists = makePlaylists()
    const first = resolveImportPlaylist(playlists, {
      playlistId: null,
      createPlaylistName: 'Liked Music',
    })
    expect(first?.name).toBe('Liked Music')
    expect(first?.kind).toBe('manual')

    const second = resolveImportPlaylist(playlists, {
      playlistId: null,
      createPlaylistName: 'liked music',
    })
    expect(second?.id).toBe(first?.id)
    expect(playlists.all()).toHaveLength(1)
  })

  it('prefers an explicit id over a name', () => {
    const playlists = makePlaylists()
    const existing = playlists.create({
      name: 'Road trip',
      description: '',
      kind: 'manual',
      rules: null,
    })
    const resolved = resolveImportPlaylist(playlists, {
      playlistId: existing.id,
      createPlaylistName: 'Something else',
    })
    expect(resolved?.id).toBe(existing.id)
    expect(playlists.all()).toHaveLength(1)
  })

  it('rejects a missing or smart playlist', () => {
    const playlists = makePlaylists()
    expect(() =>
      resolveImportPlaylist(playlists, { playlistId: 999, createPlaylistName: null }),
    ).toThrow(/no such playlist/)

    const smart = playlists.create({
      name: 'Recent',
      description: '',
      kind: 'smart',
      rules: EMPTY_SMART_RULES,
    })
    expect(() =>
      resolveImportPlaylist(playlists, { playlistId: smart.id, createPlaylistName: null }),
    ).toThrow(/smart playlist/)
  })
})
