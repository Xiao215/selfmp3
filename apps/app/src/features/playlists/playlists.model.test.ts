import { describe, expect, it } from 'vitest'
import type { Playlist } from '@selfmp3/shared'

import { orderPlaylists } from './playlists.model'

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
