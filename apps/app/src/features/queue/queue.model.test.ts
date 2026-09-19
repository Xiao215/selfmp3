import { describe, expect, it } from 'vitest'
import {
  EMPTY_QUEUE,
  moveItem,
  playNext,
  removeAt,
  type QueueState,
  type Song,
} from '@selfmp3/shared'
import {
  autoMixLine,
  dragOutcome,
  dragTarget,
  draggedOut,
  nextLabel,
  nextSummary,
  queueRows,
  removalOf,
  restoreIndex,
  restoreMoves,
  swipeOffset,
  swipeRemoves,
} from './queue.model'

const song = (id: number, duration = 240): Song => ({ id, title: `Song ${id}`, duration }) as Song

const byId = (ids: readonly number[]): Map<number, Song> => new Map(ids.map(id => [id, song(id)]))

const state = (items: number[], index: number): QueueState => ({
  ...EMPTY_QUEUE,
  items,
  index,
  original: [...items],
})

/** What Undo does to the queue: the player's `playNext`, then its move. */
function undo(now: QueueState, removal: NonNullable<ReturnType<typeof removalOf>>): QueueState {
  const moves = restoreMoves(now, removal)
  if (!moves) return now
  return moveItem(playNext(now, [removal.id]), moves.from, moves.to)
}

describe('queueRows', () => {
  it('draws playing, then next, then played, with their queue indexes', () => {
    const rows = queueRows(state([1, 2, 3, 4], 1), byId([1, 2, 3, 4]))
    expect(rows.playing?.index).toBe(1)
    expect(rows.next.map(row => [row.song.id, row.index])).toEqual([
      [3, 2],
      [4, 3],
    ])
    expect(rows.played.map(row => row.index)).toEqual([0])
  })

  it('leaves out a song the library no longer has, keeping the others where they are', () => {
    const rows = queueRows(state([1, 2, 3, 4], 0), byId([1, 2, 4]))
    expect(rows.next.map(row => row.index)).toEqual([1, 3])
  })

  it('has no playing row when the playing song is gone', () => {
    expect(queueRows(state([1, 2], 0), byId([2])).playing).toBeNull()
  })
})

describe('the counts', () => {
  const rows = queueRows(state([1, 2, 3], 0), byId([1, 2, 3]))

  it('says how many are next and for how long', () => {
    expect(nextSummary(rows.next)).toBe('2 songs · 8 min')
    expect(nextLabel(rows.next)).toBe('Next · 2 songs, 8 min')
  })

  it('says one song, not one songs', () => {
    expect(nextSummary(rows.next.slice(0, 1))).toBe('1 song · 4 min')
  })

  it('says when nothing is next', () => {
    expect(nextSummary([])).toBe('Nothing after this one')
    expect(nextLabel([])).toBe('Nothing next')
  })
})

describe('autoMixLine', () => {
  const on = { autoMix: true, canCrossfade: true, upcoming: 3, nextCrossfadeSeconds: 4 }

  it('says what the next handover will be', () => {
    expect(autoMixLine({ ...on, autoMix: false })).toBe('plays in queue order')
    expect(autoMixLine(on)).toBe('next crossfade 4s')
    expect(autoMixLine({ ...on, canCrossfade: false })).toBe('ordered by tempo, key and energy')
    expect(autoMixLine({ ...on, upcoming: 0 })).toBe('nothing to mix yet')
  })
})

describe('the swipe', () => {
  it('moves the row left only, and never past its own width', () => {
    expect(swipeOffset(40, 300)).toBe(0)
    expect(swipeOffset(-40, 300)).toBe(-40)
    expect(swipeOffset(-400, 300)).toBe(-300)
  })

  it('removes at 30% of the row and not before', () => {
    expect(swipeRemoves(-89, 300)).toBe(false)
    expect(swipeRemoves(-90, 300)).toBe(true)
    expect(swipeRemoves(-200, 300)).toBe(true)
  })

  it('never removes on a swipe to the right', () => {
    expect(swipeRemoves(200, 300)).toBe(false)
  })

  it('removes nothing before the row has been measured', () => {
    expect(swipeRemoves(-200, 0)).toBe(false)
  })
})

describe('the drag', () => {
  const rail = { left: 1000, right: 1288 }

  it('is out only a little past either edge', () => {
    expect(draggedOut(1100, rail)).toBe(false)
    expect(draggedOut(995, rail)).toBe(false)
    expect(draggedOut(980, rail)).toBe(true)
    expect(draggedOut(1300, rail)).toBe(true)
  })

  it('removes when let go outside, moves when inside, and does nothing when back home', () => {
    expect(dragOutcome({ out: true, from: 3, to: 5 })).toEqual({ kind: 'remove' })
    expect(dragOutcome({ out: false, from: 3, to: 5 })).toEqual({ kind: 'move', to: 5 })
    expect(dragOutcome({ out: false, from: 3, to: 3 })).toEqual({ kind: 'none' })
  })

  it('lands among the next rows only', () => {
    const next = { first: 3, last: 6 }
    expect(dragTarget(4, 44, 44, next)).toBe(5)
    expect(dragTarget(4, -300, 44, next)).toBe(3)
    expect(dragTarget(4, 300, 44, next)).toBe(6)
    expect(dragTarget(4, 300, 0, next)).toBe(4)
  })
})

describe('Undo', () => {
  it('remembers a song by its neighbours', () => {
    expect(removalOf([1, 2, 3], 1)).toEqual({ id: 2, index: 1, before: 3, after: 1 })
    expect(removalOf([1, 2, 3], 2)).toEqual({ id: 3, index: 2, before: null, after: 2 })
    expect(removalOf([1, 2, 3], 5)).toBeNull()
  })

  it('goes back before the song that followed it, else after the one before it', () => {
    expect(restoreIndex([1, 3, 4], { id: 2, index: 1, before: 3, after: 1 })).toBe(1)
    expect(restoreIndex([1, 4], { id: 2, index: 1, before: 3, after: 1 })).toBe(1)
    expect(restoreIndex([4, 5], { id: 2, index: 1, before: 3, after: 1 })).toBe(1)
    expect(restoreIndex([], { id: 2, index: 1, before: 3, after: 1 })).toBe(0)
  })

  it('puts a next song back exactly where it was', () => {
    const before = state([1, 2, 3, 4, 5], 1)
    const removal = removalOf(before.items, 3)
    if (!removal) throw new Error('no removal')
    const after = undo(removeAt(before, 3), removal)
    expect(after.items).toEqual([1, 2, 3, 4, 5])
    expect(after.index).toBe(1)
  })

  it('puts a played song back among the played, keeping the playing one playing', () => {
    const before = state([1, 2, 3, 4], 2)
    const removal = removalOf(before.items, 0)
    if (!removal) throw new Error('no removal')
    const after = undo(removeAt(before, 0), removal)
    expect(after.items).toEqual([1, 2, 3, 4])
    expect(after.items[after.index]).toBe(3)
  })

  it('still lands beside its neighbour after the queue has moved on', () => {
    const before = state([1, 2, 3, 4, 5], 0)
    const removal = removalOf(before.items, 3)
    if (!removal) throw new Error('no removal')
    // Removed, then the song ended and the next began.
    const later = { ...removeAt(before, 3), index: 1 }
    const after = undo(later, removal)
    expect(after.items).toEqual([1, 2, 3, 4, 5])
    expect(after.items[after.index]).toBe(2)
  })

  it('does nothing for a song that is playing again already', () => {
    const now = state([1, 2], 1)
    expect(restoreMoves(now, { id: 2, index: 0, before: null, after: null })).toBeNull()
  })
})
