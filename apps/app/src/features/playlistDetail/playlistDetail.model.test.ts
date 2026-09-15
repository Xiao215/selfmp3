import { describe, expect, it } from 'vitest'

import { cameFrom, dropIndex, moveItem } from './playlistDetail.model'

describe('where a back link goes', () => {
  const stack = (...names: string[]) => ({
    index: names.length - 1,
    routes: names.map(name => ({ name })),
  })

  it('goes back when the page it names is just behind', () => {
    expect(cameFrom(stack('index', 'playlists/index', 'playlists/[id]'), 'playlists/index')).toBe(true)
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
