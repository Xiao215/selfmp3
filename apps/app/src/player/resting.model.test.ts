import { describe, expect, it } from 'vitest'

import { passOverResting } from './resting.model'

const resting = (ids: readonly number[]) => (songId: number) => ids.includes(songId)

describe('a list starting to play', () => {
  it('passes over resting songs, and keeps the tapped one though it rests', () => {
    const start = passOverResting({ songIds: [1, 2, 3, 4], startIndex: 1 }, resting([2, 3]), true)
    expect(start).toEqual({ songIds: [1, 2, 4], startIndex: 1 })
  })

  it('starts a whole list at its first awake song', () => {
    const start = passOverResting({ songIds: [1, 2, 3], startIndex: 0 }, resting([1]), false)
    expect(start).toEqual({ songIds: [2, 3], startIndex: 0 })
  })

  it('starts after where it was asked to when that song rests', () => {
    const start = passOverResting({ songIds: [1, 2, 3, 4], startIndex: 2 }, resting([3]), false)
    expect(start).toEqual({ songIds: [1, 2, 4], startIndex: 2 })
  })

  it('plays a list that is all resting as it is', () => {
    const list = { songIds: [1, 2], startIndex: 0 }
    expect(passOverResting(list, resting([1, 2]), false)).toBe(list)
  })

  it('hands back the same list when nothing rests', () => {
    const list = { songIds: [1, 2], startIndex: 1 }
    expect(passOverResting(list, resting([]), true)).toBe(list)
  })
})
