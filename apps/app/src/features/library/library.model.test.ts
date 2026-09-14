import { describe, expect, it } from 'vitest'

import { emptyReason, songTagLookup } from './library.model'

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

/**
 * The first model test, and the reason the model rule exists.
 *
 * No simulator, no browser, no server: this is why `library.model.ts` is
 * forbidden from importing `react-native` or a component. If it ever does, this
 * file stops running and the rule has been broken in a way that is noticed.
 */
describe('why the library list is empty', () => {
  it('is not empty at all when something matched', () => {
    expect(emptyReason({ isError: false, total: 13, shown: 13 })).toBeNull()
    // Even a failed refetch is not what the reader is looking at, if there are
    // songs on the screen.
    expect(emptyReason({ isError: true, total: 13, shown: 3 })).toBeNull()
  })

  it('blames the network only when there is nothing cached to show', () => {
    expect(emptyReason({ isError: true, total: 0, shown: 0 })).toBe('unreachable')
  })

  it('tells apart an empty library from a filter that matched nothing', () => {
    // Nothing imported yet: the answer is "import something", not "try again".
    expect(emptyReason({ isError: false, total: 0, shown: 0 })).toBe('no-library')
    // Thirteen songs and none shown is the filter's doing.
    expect(emptyReason({ isError: false, total: 13, shown: 0 })).toBe('no-matches')
  })
})
