import { EMPTY_QUEUE, type QueueState } from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'

import { advancePlayable, peekPlayable } from './playable.js'

const queue = (
  items: number[],
  index: number,
  repeat: QueueState['repeat'] = 'off',
): QueueState => ({
  ...EMPTY_QUEUE,
  items,
  index,
  repeat,
})
const except =
  (...blocked: number[]) =>
  (songId: number): boolean =>
    !blocked.includes(songId)

describe('moving past songs that cannot play', () => {
  it('moves on as usual when the next song can play', () => {
    expect(advancePlayable(queue([1, 2, 3], 0), true, except()).state.index).toBe(1)
  })

  it('skips a song that cannot play', () => {
    const result = advancePlayable(queue([1, 2, 3], 0), true, except(2))
    expect(result).toMatchObject({ stop: false, state: { index: 2 } })
  })

  it('stops at the end when none of the rest can play', () => {
    expect(advancePlayable(queue([1, 2, 3], 0), true, except(2, 3)).stop).toBe(true)
  })

  it('wraps on repeat-all to the first song that can play', () => {
    const result = advancePlayable(queue([1, 2, 3], 1, 'all'), true, except(3, 1))
    expect(result).toMatchObject({ stop: false, state: { index: 1 } })
  })

  it('stops rather than going round forever when nothing can play', () => {
    expect(advancePlayable(queue([1, 2, 3], 0, 'all'), true, except(1, 2, 3)).stop).toBe(true)
    expect(advancePlayable(queue([1, 2], 0, 'one'), true, except(1)).stop).toBe(true)
  })

  it('lets Next wrap past the end and still skip', () => {
    const result = advancePlayable(queue([1, 2, 3], 2), false, except(1))
    expect(result).toMatchObject({ stop: false, state: { index: 1 } })
  })

  it('tells the engine what to preload', () => {
    expect(peekPlayable(queue([1, 2, 3], 0), except(2))).toBe(3)
    expect(peekPlayable(queue([1, 2, 3], 0), except(2, 3))).toBeNull()
    expect(peekPlayable(queue([1, 2], 0, 'one'), except())).toBe(1)
  })
})
