import { describe, expect, it } from 'vitest'
import { fuzzyRank } from '@selfmp3/shared'

import { paletteCommands, paletteResults, stepIndex, untaggedCount } from './commandPalette.model'

const song = (id: number, title: string, artist = 'YOASOBI') =>
  ({ id, title, artist, album: '', tagIds: [7] }) as never

const library = {
  songs: [song(1, 'アイドル'), song(2, 'Racing into the Night'), song(3, 'Monster')],
  playlists: [{ id: 1, name: 'Reference — evening' }] as never,
  tags: [{ id: 7, name: 'yoasobi' }] as never,
}

describe('the command palette', () => {
  it('lists every command before anything is typed', () => {
    const results = paletteResults('', library)
    expect(results.commands.map(command => command.id)).toEqual([
      'nav-library',
      'nav-playlists',
      'nav-import',
      'nav-stats',
      'nav-settings',
      'shuffle-all',
      'rescan-library',
    ])
    expect(results.songs).toEqual([])
    expect(results.recent).toEqual([])
    expect(paletteCommands(13)[5]?.hint).toBe('13 songs')
    // Tagging the untagged songs plays them, so it is offered only when there are some.
    expect(paletteCommands(13, false, 2)[5]).toEqual({
      id: 'tag-untagged',
      label: 'Tag untagged songs',
      hint: '2 untagged',
    })
    // A cloud library keeps every command but the one it truly cannot run:
    // there is no library folder to rescan. Import and Stats reach for the
    // server themselves, and tagging needs none.
    const cloud = paletteCommands(13, true, 2).map(command => command.id)
    expect(cloud).toContain('nav-import')
    expect(cloud).toContain('nav-stats')
    expect(cloud).toContain('tag-untagged')
    expect(cloud).not.toContain('rescan-library')
  })

  it('leaves out the page it was opened on, until something is typed', () => {
    const on = (pathname: string) =>
      paletteResults('', library, false, { pathname }).commands.map(command => command.id)
    expect(on('/library')).not.toContain('nav-library')
    // Home is not Library: Library is somewhere to go from it.
    expect(on('/')).toContain('nav-library')
    expect(on('/stats/report')).not.toContain('nav-stats')
    expect(on('/settings')).not.toContain('nav-settings')
    // A playlist's own page still has the list of playlists to go to.
    expect(on('/playlists/3')).toContain('nav-playlists')
    expect(on('/playlists')).not.toContain('nav-playlists')
    expect(
      paletteResults('library', library, false, { pathname: '/library' }).commands.map(c => c.id),
    ).toContain('nav-library')
  })

  it('names the destinations the way the sidebar does', () => {
    expect(paletteCommands(1).find(command => command.id === 'nav-stats')?.label).toBe(
      'Go to Stats',
    )
  })

  it('offers what was played lately, and only before anything is typed', () => {
    const dated = {
      ...library,
      songs: [
        { ...(song(1, 'アイドル') as object), lastPlayedAt: '2026-09-10T10:00:00Z' },
        { ...(song(3, 'Monster') as object), lastPlayedAt: null },
      ] as never,
      playlists: [{ id: 9, name: 'evening', lastPlayedAt: '2026-09-11T10:00:00Z' }] as never,
    }
    expect(paletteResults('', dated, false, { currentSongId: 3 }).recent).toHaveLength(3)
    expect(paletteResults('mon', dated, false, { currentSongId: 3 }).recent).toEqual([])
  })

  it('finds an artist as well as a tag of the same name', () => {
    const results = paletteResults('yoasobi', library)
    expect(results.artists.map(artist => artist.name)).toEqual(['YOASOBI'])
    expect(results.tags).toHaveLength(1)
  })

  it('finds songs, playlists and tags by what is typed', () => {
    const results = paletteResults('monster', library)
    expect(results.songs.map(item => (item as { id: number }).id)).toEqual([3])
    expect(paletteResults('evening', library).playlists).toHaveLength(1)
    expect(paletteResults('yoasobi', library).tags).toHaveLength(1)
    expect(paletteResults('settings', library).commands[0]?.id).toBe('nav-settings')
  })

  it('keeps the eight best songs in the order a full ranking gives', () => {
    const many = {
      ...library,
      songs: Array.from({ length: 40 }, (_, id) =>
        song(
          id,
          id % 3 === 0 ? `Night ${40 - id}` : `Midnight ${id}`,
          id % 2 ? 'Nightcrawler' : 'x',
        ),
      ),
    }
    const ranked = fuzzyRank(
      'night',
      many.songs as { title: string; artist: string; album: string }[],
      s => `${s.title} ${s.artist} ${s.album}`,
    )
    expect(paletteResults('night', many).songs).toEqual(ranked.slice(0, 8).map(match => match.item))
  })

  it('counts untagged songs once per library', () => {
    const songs = [song(1, 'a'), { ...(song(2, 'b') as object), tagIds: [] } as never]
    expect(untaggedCount(songs)).toBe(1)
    expect(paletteResults('', { ...library, songs }).commands[5]?.hint).toBe('1 untagged')
  })

  it('wraps the highlight at both ends', () => {
    expect(stepIndex(0, -1, 5)).toBe(4)
    expect(stepIndex(4, 1, 5)).toBe(0)
    expect(stepIndex(2, 1, 0)).toBe(0)
  })
})
