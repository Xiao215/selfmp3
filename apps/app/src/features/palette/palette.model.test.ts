import { describe, expect, it } from 'vitest'
import { fuzzyRank } from '@selfmp3/shared'

import {
  lyricsQueryFor,
  paletteCommands,
  paletteResults,
  recentItems,
  stepIndex,
  type RecentItem,
  untaggedCount,
} from './palette.model'

const song = (id: number, title: string, artist = 'YOASOBI') =>
  ({ id, title, artist, album: '', tagIds: [7], missing: false }) as never

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
      'nav-inbox',
      'shuffle-all',
      'rescan-library',
    ])
    expect(results.songs).toEqual([])
    expect(results.recent).toEqual([])
    expect(paletteCommands(13)[6]?.hint).toBe('13 songs')
    expect(paletteCommands(13, false, 2)[5]?.hint).toBe('2 untagged')
    // A cloud library has no server to count plays on or tag from; its imports wait for one.
    expect(paletteCommands(13, true).map(command => command.id)).toContain('nav-import')
    expect(paletteCommands(13, true).map(command => command.id)).not.toContain('nav-stats')
    expect(paletteCommands(13, true).map(command => command.id)).not.toContain('nav-inbox')
    expect(paletteCommands(13, true).map(command => command.id)).not.toContain('rescan-library')
  })

  it('leaves out the page it was opened on, until something is typed', () => {
    const on = (pathname: string) =>
      paletteResults('', library, false, { pathname }).commands.map(command => command.id)
    expect(on('/')).not.toContain('nav-library')
    expect(on('/stats/report')).not.toContain('nav-stats')
    expect(on('/settings')).not.toContain('nav-settings')
    // A playlist's own page still has the list of playlists to go to.
    expect(on('/playlists/3')).toContain('nav-playlists')
    expect(on('/playlists')).not.toContain('nav-playlists')
    expect(
      paletteResults('library', library, false, { pathname: '/' }).commands.map(c => c.id),
    ).toContain('nav-library')
  })

  it('names the destinations the way the sidebar does', () => {
    expect(paletteCommands(1).find(command => command.id === 'nav-stats')?.label).toBe('Go to Stats')
  })

  it('offers what was played lately, the loaded song first', () => {
    const dated = {
      ...library,
      songs: [
        { ...(song(1, 'アイドル') as object), lastPlayedAt: '2026-09-10T10:00:00Z' },
        { ...(song(2, 'Racing') as object), lastPlayedAt: '2026-09-12T10:00:00Z' },
        { ...(song(3, 'Monster') as object), lastPlayedAt: null },
        { ...(song(4, 'Gone') as object), lastPlayedAt: '2026-09-13T10:00:00Z', missing: true },
      ] as never,
      playlists: [{ id: 9, name: 'evening', lastPlayedAt: '2026-09-11T10:00:00Z' }] as never,
    }
    const keys = (items: readonly RecentItem[]) =>
      items.map(item => (item.kind === 'song' ? `song-${item.song.id}` : `playlist-${item.playlist.id}`))
    expect(keys(recentItems(dated))).toEqual(['song-2', 'playlist-9', 'song-1'])
    expect(keys(recentItems(dated, 3))).toEqual(['song-3', 'song-2', 'playlist-9', 'song-1'])
    expect(keys(recentItems(dated, 1, 2))).toEqual(['song-1', 'song-2'])
    expect(recentItems(undefined)).toEqual([])
    expect(paletteResults('', dated, false, { currentSongId: 3 }).recent).toHaveLength(4)
    expect(paletteResults('mon', dated, false, { currentSongId: 3 }).recent).toEqual([])
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
    const songs = [
      song(1, 'a'),
      { ...(song(2, 'b') as object), tagIds: [] } as never,
      { ...(song(3, 'c') as object), tagIds: [], missing: true } as never,
    ]
    expect(untaggedCount(songs)).toBe(1)
    expect(paletteResults('', { ...library, songs }).commands[5]?.hint).toBe('1 untagged')
  })

  it('searches lyrics only once the query means something', () => {
    expect(lyricsQueryFor('ab')).toBe('')
    expect(lyricsQueryFor(' abc ')).toBe('abc')
    expect(lyricsQueryFor('無敵')).toBe('無敵')
    expect(lyricsQueryFor('無')).toBe('')
  })

  it('wraps the highlight at both ends', () => {
    expect(stepIndex(0, -1, 5)).toBe(4)
    expect(stepIndex(4, 1, 5)).toBe(0)
    expect(stepIndex(2, 1, 0)).toBe(0)
  })
})
