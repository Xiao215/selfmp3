import { describe, expect, it } from 'vitest'
import { fuzzyRank } from '@selfmp3/shared'

import {
  lyricsQueryFor,
  paletteCommands,
  paletteResults,
  stepIndex,
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
    expect(paletteCommands(13)[6]?.hint).toBe('13 songs')
    expect(paletteCommands(13, false, 2)[5]?.hint).toBe('2 untagged')
    // A cloud library has no Mac to count plays on or tag from; its imports wait for one.
    expect(paletteCommands(13, true).map(command => command.id)).toContain('nav-import')
    expect(paletteCommands(13, true).map(command => command.id)).not.toContain('nav-stats')
    expect(paletteCommands(13, true).map(command => command.id)).not.toContain('nav-inbox')
    expect(paletteCommands(13, true).map(command => command.id)).not.toContain('rescan-library')
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
