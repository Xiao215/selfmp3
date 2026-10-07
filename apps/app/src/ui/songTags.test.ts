import { describe, expect, it } from 'vitest'

import { songTagLookup } from './songTags'

describe('a song’s tags', () => {
  const tags = [
    { id: 1, name: 'chill' },
    { id: 2, name: 'loud' },
  ]

  it('are the tags its ids name, skipping ids no tag has', () => {
    const lookup = songTagLookup(tags)
    expect(lookup({ tagIds: [2, 9, 1] }).map(tag => tag.name)).toEqual(['loud', 'chill'])
  })

  it('are the same array for the same song, so its row is not redrawn', () => {
    const lookup = songTagLookup(tags)
    const song = { tagIds: [1] }
    expect(lookup(song)).toBe(lookup(song))
    // A song with no tags shares one empty array.
    expect(lookup({ tagIds: [] })).toBe(lookup({ tagIds: [] }))
  })
})
