import { describe, expect, it } from 'vitest'
import type { Song } from '@selfmp3/shared'

import { tagChanges, tagsAcross, undoTagChange } from './tagPicker.model'

const song = (id: number, tagIds: number[]): Song => ({ id, tagIds }) as unknown as Song

describe('what a tag is to a set of songs', () => {
  it('sorts tags into on all, on some, and neither', () => {
    const across = tagsAcross([song(1, [10, 20]), song(2, [10]), song(3, [10, 30])])
    expect([...across.all]).toEqual([10])
    expect([...across.some].sort()).toEqual([20, 30])
  })

  it('has nothing on all of no songs', () => {
    const across = tagsAcross([])
    expect(across.all.size).toBe(0)
    expect(across.some.size).toBe(0)
  })
})

describe('what a set of ticks changes', () => {
  const across = tagsAcross([song(1, [10, 20]), song(2, [10])])

  it('adds a ticked tag that was not on all of them, mixed or new', () => {
    const { add, remove } = tagChanges(across, new Set([10, 20, 40]))
    expect({ add, remove }).toEqual({ add: [20, 40], remove: [] })
  })

  it('removes a tag that was on all of them and is unticked', () => {
    const { add, remove } = tagChanges(across, new Set())
    expect({ add, remove }).toEqual({ add: [], remove: [10] })
  })

  it('leaves a mixed tag alone while it stays unticked', () => {
    const { add, remove, after } = tagChanges(across, new Set([10]))
    expect({ add, remove }).toEqual({ add: [], remove: [] })
    expect([...after.some]).toEqual([20])
  })

  it('takes a ticked-then-unticked tag back off, before the library has answered', () => {
    const ticked = tagChanges(across, new Set([10, 40]))
    expect(ticked.add).toEqual([40])
    const unticked = tagChanges(ticked.after, new Set([10]))
    expect({ add: unticked.add, remove: unticked.remove }).toEqual({ add: [], remove: [40] })
  })

  it('stops drawing a mixed tag mixed once it is ticked', () => {
    const { after } = tagChanges(across, new Set([10, 20]))
    expect(after.some.size).toBe(0)
    expect([...after.all].sort()).toEqual([10, 20])
  })
})

describe('a tag change the library did not take', () => {
  const across = tagsAcross([song(1, [10, 20]), song(2, [10])])

  it('takes back only the failed tag, and keeps a later tap that worked', () => {
    // 40 ticked (it fails), then 50 ticked (it lands).
    const first = tagChanges(across, new Set([10, 40]))
    const second = tagChanges(first.after, new Set([10, 40, 50]))
    const undone = undoTagChange(second.after, across, 40, 'add')
    expect([...undone.all].sort()).toEqual([10, 50])
  })

  it('puts a mixed tag back to mixed when ticking it on the rest failed', () => {
    const ticked = tagChanges(across, new Set([10, 20]))
    const undone = undoTagChange(ticked.after, across, 20, 'add')
    expect([...undone.all]).toEqual([10])
    expect([...undone.some]).toEqual([20])
  })

  it('ticks a tag again when taking it off failed', () => {
    const unticked = tagChanges(across, new Set())
    const undone = undoTagChange(unticked.after, across, 10, 'remove')
    expect([...undone.all]).toEqual([10])
  })

  it('leaves a tag tapped again since to that later tap', () => {
    const ticked = tagChanges(across, new Set([10, 40]))
    const unticked = tagChanges(ticked.after, new Set([10]))
    expect(undoTagChange(unticked.after, across, 40, 'add')).toBe(unticked.after)
  })
})
