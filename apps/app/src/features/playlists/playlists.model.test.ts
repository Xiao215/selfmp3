import { describe, expect, it } from 'vitest'
import { EMPTY_SMART_RULES, type Playlist } from '@selfmp3/shared'

import { newPlaylist, orderPlaylists } from './playlists.model'

const playlist = (name: string, pinned: boolean): Playlist =>
  ({ id: name.length, name, pinned, kind: 'manual' }) as unknown as Playlist

describe('the order playlists appear in', () => {
  it('puts pinned lists above the alphabet, not into it', () => {
    const ordered = orderPlaylists([
      playlist('Aardvark', false),
      playlist('Zebra', true),
      playlist('Beetle', false),
    ])
    expect(ordered.map(p => p.name)).toEqual(['Zebra', 'Aardvark', 'Beetle'])
  })

  it('sorts by name within each group', () => {
    const ordered = orderPlaylists([
      playlist('Evening', true),
      playlist('Morning', true),
      playlist('Night', false),
      playlist('Afternoon', false),
    ])
    expect(ordered.map(p => p.name)).toEqual(['Evening', 'Morning', 'Afternoon', 'Night'])
  })

  it('leaves the caller’s array alone', () => {
    const given = [playlist('B', false), playlist('A', false)]
    orderPlaylists(given)
    expect(given.map(p => p.name)).toEqual(['B', 'A'])
  })
})

describe('making a playlist', () => {
  it('gives a smart playlist the empty rules and a manual one none', () => {
    expect(newPlaylist('smart', 'Chill')).toEqual({
      name: 'Chill',
      description: '',
      kind: 'smart',
      rules: EMPTY_SMART_RULES,
    })
    expect(newPlaylist('manual', 'Evening')?.rules).toBeNull()
  })

  it('trims the name, and makes nothing of a name that is only space', () => {
    expect(newPlaylist('manual', '  Road trip  ')?.name).toBe('Road trip')
    expect(newPlaylist('manual', '   ')).toBeNull()
  })
})
