import { describe, expect, it } from 'vitest'
import { EMPTY_QUEUE, SOUND_DIMENSIONS, type QueueState, type Song } from '@selfmp3/shared'

import { keepGoingDue, keepGoingSongs } from './keepGoing.model'

const NOW = Date.parse('2026-10-25T12:00:00.000Z')

const song = (id: number, restUntil: string | null = null): Song =>
  ({ id, title: `Song ${id}`, restUntil }) as unknown as Song

/** A packed vector pointing mostly one way: songs on the same side sound alike. */
const toward = (side: number): Int8Array => {
  const vector = new Int8Array(SOUND_DIMENSIONS)
  vector[0] = side * 120
  vector[1] = 40
  return vector
}

const queue = (items: number[], index = items.length - 1): QueueState => ({
  ...EMPTY_QUEUE,
  items,
  original: items,
  index,
})

describe('keep going', () => {
  it('is due while the last song in Up next plays, with repeat off', () => {
    expect(keepGoingDue(queue([1, 2]), true)).toBe(true)
    expect(keepGoingDue(queue([1, 2], 0), true)).toBe(false)
    expect(keepGoingDue(queue([1, 2]), false)).toBe(false)
    expect(keepGoingDue({ ...queue([1, 2]), repeat: 'all' }, true)).toBe(false)
    expect(keepGoingDue(EMPTY_QUEUE, true)).toBe(false)
  })

  it('adds songs that sound like the last ones, nearest first', () => {
    const sides: Record<number, number> = { 1: 1, 2: 1, 3: -1, 4: 1, 5: -1, 6: 1 }
    const picks = keepGoingSongs({
      queue: queue([1, 2]),
      songs: [1, 2, 3, 4, 5, 6].map(id => song(id)),
      vectorOf: id => toward(sides[id] ?? 0),
      now: NOW,
      random: () => 0.5,
    })
    expect(picks).toHaveLength(2)
    expect(new Set(picks)).toEqual(new Set([4, 6]))
  })

  it('never adds a song Up next has had, or one resting', () => {
    const later = new Date(NOW + 86_400_000).toISOString()
    const picks = keepGoingSongs({
      queue: queue([1, 2]),
      songs: [song(1), song(2), song(3, later), song(4)],
      vectorOf: () => null,
      count: 5,
      now: NOW,
    })
    expect(picks).toEqual([4])
  })

  it('picks in no particular order with nothing to go on by sound', () => {
    const picks = keepGoingSongs({
      queue: queue([1]),
      songs: [1, 2, 3, 4].map(id => song(id)),
      vectorOf: () => null,
      now: NOW,
      random: () => 0,
    })
    expect(picks).toHaveLength(2)
    expect(picks).not.toContain(1)
  })
})
