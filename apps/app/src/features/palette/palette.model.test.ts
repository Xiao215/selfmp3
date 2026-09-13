import { describe, expect, it } from 'vitest'

import { lyricsQueryFor, paletteCommands, paletteResults, stepIndex } from './palette.model'

const song = (id: number, title: string, artist = 'YOASOBI') =>
  ({ id, title, artist, album: '' }) as never

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
      'nav-settings',
      'shuffle-all',
    ])
    expect(results.songs).toEqual([])
    expect(paletteCommands(13)[4]?.hint).toBe('13 songs')
    // A cloud library has no Mac to import with.
    expect(paletteCommands(13, true).map(command => command.id)).not.toContain('nav-import')
  })

  it('finds songs, playlists and tags by what is typed', () => {
    const results = paletteResults('monster', library)
    expect(results.songs.map(item => (item as { id: number }).id)).toEqual([3])
    expect(paletteResults('evening', library).playlists).toHaveLength(1)
    expect(paletteResults('yoasobi', library).tags).toHaveLength(1)
    expect(paletteResults('settings', library).commands[0]?.id).toBe('nav-settings')
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
