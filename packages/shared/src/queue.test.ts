import { describe, expect, it } from 'vitest'
import {
  advance,
  cycleRepeat,
  EMPTY_QUEUE,
  enqueue,
  moveItem,
  peekNext,
  playFrom,
  playNext,
  previous,
  queueSections,
  removeAt,
  setShuffle,
  shuffleArray,
  type QueueState,
} from './queue.js'

/** A deterministic "random" source so shuffle tests are reproducible. */
function seeded(seed: number): () => number {
  let value = seed
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296
    return value / 4294967296
  }
}

const base = (patch: Partial<QueueState> = {}): QueueState => ({ ...EMPTY_QUEUE, ...patch })

describe('shuffleArray', () => {
  it('keeps every element', () => {
    const input = [1, 2, 3, 4, 5]
    const output = shuffleArray(input, seeded(42))
    expect([...output].sort((a, b) => a - b)).toEqual(input)
  })

  it('does not mutate its input', () => {
    const input = [1, 2, 3]
    shuffleArray(input, seeded(1))
    expect(input).toEqual([1, 2, 3])
  })

  it('handles empty and single-element arrays', () => {
    expect(shuffleArray([])).toEqual([])
    expect(shuffleArray([7])).toEqual([7])
  })
})

describe('playFrom', () => {
  it('plays a list in order', () => {
    const state = playFrom(base(), [1, 2, 3], 1)
    expect(state.items).toEqual([1, 2, 3])
    expect(state.index).toBe(1)
  })

  it('keeps the chosen track first when shuffling', () => {
    // Tapping a song with shuffle on must play *that* song.
    const state = playFrom(base({ shuffle: true }), [1, 2, 3, 4, 5], 2, seeded(7))
    expect(state.items[0]).toBe(3)
    expect(state.index).toBe(0)
    expect([...state.items].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
  })

  it('remembers the unshuffled order', () => {
    const state = playFrom(base({ shuffle: true }), [1, 2, 3], 0, seeded(3))
    expect(state.original).toEqual([1, 2, 3])
  })

  it('clamps an out-of-range start index', () => {
    expect(playFrom(base(), [1, 2, 3], 99).index).toBe(2)
    expect(playFrom(base(), [1, 2, 3], -5).index).toBe(0)
  })

  it('handles an empty list', () => {
    const state = playFrom(base(), [], 0)
    expect(state.items).toEqual([])
    expect(state.index).toBe(-1)
  })
})

describe('setShuffle', () => {
  it('keeps the current track playing when switched on', () => {
    const start = base({ items: [1, 2, 3, 4], index: 2, original: [1, 2, 3, 4] })
    const shuffled = setShuffle(start, true, seeded(9))
    expect(shuffled.items[0]).toBe(3)
    expect(shuffled.index).toBe(0)
  })

  it('restores the original order when switched off', () => {
    const start = base({
      items: [3, 1, 4, 2],
      index: 0,
      original: [1, 2, 3, 4],
      shuffle: true,
    })
    const restored = setShuffle(start, false)
    expect(restored.items).toEqual([1, 2, 3, 4])
    // Song 3 was playing and must still be playing, now at its real position.
    expect(restored.index).toBe(2)
  })

  it('is a no-op when the mode is unchanged', () => {
    const start = base({ items: [1, 2], index: 0 })
    expect(setShuffle(start, false)).toBe(start)
  })

  /*
   * Turning shuffle off replays `original` wholesale, so every edit made while
   * shuffled has to have reached it too. These are the three gestures that a
   * listener can reach with shuffle on.
   */
  it('keeps a song added while shuffled', () => {
    const shuffled = setShuffle(playFrom(base(), [1, 2, 3], 0, seeded(4)), true, seeded(4))
    const restored = setShuffle(enqueue(shuffled, [9]), false)
    expect(restored.items).toEqual([1, 2, 3, 9])
  })

  it('keeps a song queued to play next while shuffled', () => {
    const shuffled = setShuffle(playFrom(base(), [1, 2, 3], 0, seeded(4)), true, seeded(4))
    const restored = setShuffle(playNext(shuffled, [7]), false)
    expect(restored.items).toEqual([1, 2, 3, 7])
  })

  it('does not bring back a song removed while shuffled', () => {
    const shuffled = setShuffle(playFrom(base(), [1, 2, 3], 0, seeded(4)), true, seeded(4))
    const without = removeAt(shuffled, shuffled.items.indexOf(2))
    const restored = setShuffle(without, false)
    expect(restored.items).toEqual([1, 3])
  })
})

describe('advance', () => {
  it('moves to the next track', () => {
    const { state, stop } = advance(base({ items: [1, 2, 3], index: 0 }), true)
    expect(state.index).toBe(1)
    expect(stop).toBe(false)
  })

  it('stops at the end when a track finishes on its own', () => {
    const { stop } = advance(base({ items: [1, 2], index: 1 }), true)
    expect(stop).toBe(true)
  })

  it('wraps to the start when the user presses next at the end', () => {
    const { state, stop } = advance(base({ items: [1, 2], index: 1 }), false)
    expect(state.index).toBe(0)
    expect(stop).toBe(false)
  })

  it('loops the whole queue with repeat all', () => {
    const { state, stop } = advance(base({ items: [1, 2], index: 1, repeat: 'all' }), true)
    expect(state.index).toBe(0)
    expect(stop).toBe(false)
  })

  it('stays put with repeat one on auto-advance', () => {
    const start = base({ items: [1, 2], index: 0, repeat: 'one' })
    const { state, stop } = advance(start, true)
    expect(state.index).toBe(0)
    expect(stop).toBe(false)
  })

  it('still moves on with repeat one when the user presses next', () => {
    const { state } = advance(base({ items: [1, 2], index: 0, repeat: 'one' }), false)
    expect(state.index).toBe(1)
  })

  it('handles an empty queue', () => {
    expect(advance(base(), true).stop).toBe(true)
  })
})

describe('peekNext', () => {
  it('reports what the engine should preload', () => {
    expect(peekNext(base({ items: [1, 2, 3], index: 0 }))).toBe(2)
  })

  it('returns null at the end with repeat off', () => {
    expect(peekNext(base({ items: [1, 2], index: 1 }))).toBeNull()
  })

  it('wraps with repeat all', () => {
    expect(peekNext(base({ items: [1, 2], index: 1, repeat: 'all' }))).toBe(1)
  })

  it('returns the same track with repeat one', () => {
    expect(peekNext(base({ items: [1, 2], index: 0, repeat: 'one' }))).toBe(1)
  })
})

describe('previous', () => {
  it('steps back', () => {
    expect(previous(base({ items: [1, 2, 3], index: 2 })).index).toBe(1)
  })

  it('does not go below the first track', () => {
    const start = base({ items: [1, 2], index: 0 })
    expect(previous(start)).toBe(start)
  })
})

describe('playNext', () => {
  it('inserts straight after the current track', () => {
    const state = playNext(base({ items: [1, 2, 3], index: 0 }), [9])
    expect(state.items).toEqual([1, 9, 2, 3])
    expect(state.index).toBe(0)
  })

  it('moves rather than duplicates a track already in the queue', () => {
    const state = playNext(base({ items: [1, 2, 3], index: 0 }), [3])
    expect(state.items).toEqual([1, 3, 2])
  })

  it('keeps pointing at the same song after a move', () => {
    const state = playNext(base({ items: [1, 2, 3], index: 1 }), [3])
    expect(state.items[state.index]).toBe(2)
  })

  it('does not queue a second copy of the track already playing', () => {
    const state = playNext(base({ items: [1, 2, 3], index: 0 }), [1, 5])
    expect(state.items).toEqual([1, 5, 2, 3])
  })

  it('is a no-op when the only id given is already playing', () => {
    const start = base({ items: [1, 2, 3], index: 0 })
    expect(playNext(start, [1])).toBe(start)
  })
})

describe('enqueue', () => {
  it('appends to the end', () => {
    expect(enqueue(base({ items: [1, 2], index: 0 }), [3]).items).toEqual([1, 2, 3])
  })

  it('ignores songs already queued', () => {
    const start = base({ items: [1, 2], index: 0 })
    expect(enqueue(start, [2]).items).toEqual([1, 2])
  })
})

describe('removeAt', () => {
  it('removes an entry after the current track without moving the pointer', () => {
    const state = removeAt(base({ items: [1, 2, 3], index: 0 }), 2)
    expect(state.items).toEqual([1, 2])
    expect(state.index).toBe(0)
  })

  it('shifts the pointer when removing an earlier entry', () => {
    const state = removeAt(base({ items: [1, 2, 3], index: 2 }), 0)
    expect(state.items).toEqual([2, 3])
    expect(state.items[state.index]).toBe(3)
  })

  it('clamps when removing the last, currently playing entry', () => {
    const state = removeAt(base({ items: [1, 2], index: 1 }), 1)
    expect(state.items).toEqual([1])
    expect(state.index).toBe(0)
  })

  it('ignores an out-of-range position', () => {
    const start = base({ items: [1], index: 0 })
    expect(removeAt(start, 5)).toBe(start)
  })
})

describe('moveItem', () => {
  it('reorders', () => {
    expect(moveItem(base({ items: [1, 2, 3], index: 0 }), 0, 2).items).toEqual([2, 3, 1])
  })

  it('follows the currently playing track to its new index', () => {
    const state = moveItem(base({ items: [1, 2, 3], index: 0 }), 0, 2)
    expect(state.items[state.index]).toBe(1)
    expect(state.index).toBe(2)
  })

  it('is a no-op when nothing moves', () => {
    const start = base({ items: [1, 2], index: 0 })
    expect(moveItem(start, 1, 1)).toBe(start)
  })
})

describe('cycleRepeat', () => {
  it('cycles off -> all -> one -> off', () => {
    expect(cycleRepeat('off')).toBe('all')
    expect(cycleRepeat('all')).toBe('one')
    expect(cycleRepeat('one')).toBe('off')
  })
})

describe('queueSections', () => {
  it('puts the playing song first, then what is next, then what has played', () => {
    const sections = queueSections(base({ items: [10, 20, 30, 40, 50], index: 2 }))
    expect(sections.playing).toEqual({ id: 30, index: 2 })
    expect(sections.next).toEqual([
      { id: 40, index: 3 },
      { id: 50, index: 4 },
    ])
    expect(sections.played).toEqual([
      { id: 10, index: 0 },
      { id: 20, index: 1 },
    ])
  })

  it('has nothing played at the start and nothing next at the end', () => {
    expect(queueSections(base({ items: [1, 2], index: 0 })).played).toEqual([])
    expect(queueSections(base({ items: [1, 2], index: 1 })).next).toEqual([])
  })

  it('treats every song as still to come while nothing is loaded', () => {
    const sections = queueSections(base({ items: [1, 2], index: -1 }))
    expect(sections.playing).toBeNull()
    expect(sections.next.map(entry => entry.id)).toEqual([1, 2])
    expect(sections.played).toEqual([])
  })

  it('is empty for an empty queue', () => {
    expect(queueSections(EMPTY_QUEUE)).toEqual({ playing: null, next: [], played: [] })
  })

  it('keeps the real index on every entry, so an edit lands where it was aimed', () => {
    const state = base({ items: [5, 6, 7], index: 1 })
    const { next, played } = queueSections(state)
    expect(removeAt(state, next[0]?.index ?? -1).items).toEqual([5, 6])
    expect(removeAt(state, played[0]?.index ?? -1).items).toEqual([6, 7])
  })
})
