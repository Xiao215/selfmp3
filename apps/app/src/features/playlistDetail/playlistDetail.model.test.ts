import { describe, expect, it } from 'vitest'

import { cameFrom, dropIndex, dropSide, movedTo, moveItem } from './playlistDetail.model'

describe('where a back link goes', () => {
  const stack = (...names: string[]) => ({
    index: names.length - 1,
    routes: names.map(name => ({ name })),
  })

  it('goes back when the page it names is just behind', () => {
    expect(cameFrom(stack('index', 'playlists/index', 'playlists/[id]'), 'playlists/index')).toBe(
      true,
    )
  })

  it('does not, after a playlist made from the library, or a deep link', () => {
    expect(cameFrom(stack('index', 'playlists/[id]'), 'playlists/index')).toBe(false)
    expect(cameFrom(stack('playlists/[id]'), 'playlists/index')).toBe(false)
    expect(cameFrom(undefined, 'playlists/index')).toBe(false)
  })
})

describe('reordering a playlist', () => {
  it('moves an item down and up', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('leaves the list alone for a move to where it already is', () => {
    expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c'])
  })

  it('does not touch the caller’s list, and ignores a position that is not there', () => {
    const given = ['a', 'b']
    expect(moveItem(given, 5, 0)).toEqual(['a', 'b'])
    moveItem(given, 0, 1)
    expect(given).toEqual(['a', 'b'])
  })

  it('lands a drag on the nearest whole row, never past either end', () => {
    expect(dropIndex(2, 0, 50, 5)).toBe(2)
    expect(dropIndex(2, 74, 50, 5)).toBe(3)
    expect(dropIndex(2, 76, 50, 5)).toBe(4)
    expect(dropIndex(2, -400, 50, 5)).toBe(0)
    expect(dropIndex(2, 400, 50, 5)).toBe(4)
  })

  it('stays put before the row height is known', () => {
    expect(dropIndex(3, 120, 0, 5)).toBe(3)
  })
})

/*
 * What a finished move means, whichever way the row was moved: the grip a
 * mouse drags at desktop width and a held finger on a phone both end here,
 * and the order this returns is the one order the server is sent.
 */
describe('which edge the drop line falls on', () => {
  it('is under the row when the song is going down the list', () => {
    // The first of four dragged to the foot lands after the old last row, so a
    // line over that row would promise a place the song does not take.
    expect(dropSide({ from: 0, over: 3 }, 3)).toBe('below')
  })

  it('is over the row when the song is coming up the list', () => {
    expect(dropSide({ from: 3, over: 0 }, 0)).toBe('above')
  })

  it('is nowhere on the row being dragged, or on any other row', () => {
    expect(dropSide({ from: 2, over: 2 }, 2)).toBeNull()
    expect(dropSide({ from: 0, over: 3 }, 1)).toBeNull()
    expect(dropSide(null, 0)).toBeNull()
  })
})

describe('what a finished move sends', () => {
  const ids = [10, 11, 12, 13, 14]

  it('gives the whole new order, and where the row landed', () => {
    expect(movedTo(ids, 0, 110, 50)).toEqual({ to: 2, songIds: [11, 12, 10, 13, 14] })
    expect(movedTo(ids, 4, -160, 50)).toEqual({ to: 1, songIds: [10, 14, 11, 12, 13] })
  })

  it('sends nothing for a hold let go where it started', () => {
    expect(movedTo(ids, 2, 0, 50)).toBeNull()
    // Less than half a row is not a move.
    expect(movedTo(ids, 2, 20, 50)).toBeNull()
    // A move that was taken away comes back as no travel at all.
    expect(movedTo(ids, 0, 0, 50)).toBeNull()
  })

  it('sends nothing before a row has been measured', () => {
    expect(movedTo(ids, 1, 400, 0)).toBeNull()
  })

  it('never carries a row past either end', () => {
    expect(movedTo(ids, 1, -400, 50)).toEqual({ to: 0, songIds: [11, 10, 12, 13, 14] })
    expect(movedTo(ids, 1, 400, 50)).toEqual({ to: 4, songIds: [10, 12, 13, 14, 11] })
  })

  it('keeps every song, and the caller’s list', () => {
    const given = [...ids]
    const moved = movedTo(given, 3, -150, 50)
    expect(moved?.songIds).toHaveLength(ids.length)
    expect([...(moved?.songIds ?? [])].sort((a, b) => a - b)).toEqual(ids)
    expect(given).toEqual(ids)
  })

  it('has nothing to say about an empty playlist', () => {
    expect(movedTo([], 0, 100, 50)).toBeNull()
  })
})
