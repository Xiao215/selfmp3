import { describe, expect, it } from 'vitest'
import type { Song } from '@selfmp3/shared'

import { tagChanges, tagsAcross } from './tagPicker.model'

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
    expect(tagChanges(across, new Set([10, 20, 40]))).toEqual({ add: [20, 40], remove: [] })
  })

  it('removes a tag that was on all of them and is unticked', () => {
    expect(tagChanges(across, new Set())).toEqual({ add: [], remove: [10] })
  })

  it('leaves a mixed tag alone while it stays unticked', () => {
    expect(tagChanges(across, new Set([10]))).toEqual({ add: [], remove: [] })
  })
})
