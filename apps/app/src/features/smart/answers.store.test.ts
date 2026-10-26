import { describe, expect, it } from 'vitest'
import type { DescribeResult, Understanding } from '@selfmp3/shared'
import { changeAnswer, editAnswer, keepAnswer, keptAnswer, understandingOf } from './answers.store'

const understanding: Understanding = {
  name: 'Jukebox',
  anyTags: [],
  artists: [],
  albums: ['Jukebox'],
  noTags: [],
  energy: { min: null, max: null },
  bpm: { min: null, max: null },
  year: { min: null, max: null },
  words: null,
  loved: true,
  playedWithinDays: null,
  notPlayedWithinDays: null,
  addedWithinDays: null,
  size: null,
  minutes: null,
  sound: null,
  brief: null,
}

const result = (songIds: number[]): DescribeResult => ({
  understanding,
  fit: songIds.length,
  loosened: [],
  unknown: [],
  picks: songIds.map(songId => ({ songId, why: null })),
})

describe('an answer with chips taken away', () => {
  it('is changed from what is shown, and only for that answer', () => {
    const one = keepAnswer('jukebox songs', result([1, 2]))
    const two = keepAnswer('jpop', result([3]))
    editAnswer(one, { ...understanding, loved: null })
    expect(understandingOf(keptAnswer(one)!).loved).toBeNull()
    expect(understandingOf(keptAnswer(two)!).loved).toBe(true)
  })

  it('is unchanged again once new songs come for it', () => {
    const id = keepAnswer('jukebox again', result([1, 2]))
    editAnswer(id, { ...understanding, loved: null })
    changeAnswer(id, result([4]))
    expect(keptAnswer(id)!.edited).toBeNull()
  })
})
