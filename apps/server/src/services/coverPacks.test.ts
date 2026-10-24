import { describe, expect, it } from 'vitest'
import type { CloudCoverPack } from '@selfmp3/shared'
import { planCoverPacks } from './coverPacks.js'

/** `covers/<64 hex>.jpg`, from a letter: a key the schema would take. */
const key = (letter: string): string => `covers/${letter.repeat(64)}.jpg`

const pack = (name: string, covers: [string, number][]): CloudCoverPack => ({
  key: `covers/${name.repeat(64)}.pack`,
  size: covers.reduce((sum, [, size]) => sum + size, 0),
  covers,
})

const everything = (): boolean => true

describe('planCoverPacks', () => {
  it('packs a library from nothing, a target’s worth at a time, in key order', () => {
    const live = new Map([
      [key('c'), 40],
      [key('a'), 60],
      [key('b'), 50],
      [key('d'), 30],
    ])
    const plan = planCoverPacks(live, [], everything, 100)
    expect(plan.kept).toEqual([])
    expect(plan.groups.map(group => group.map(cover => cover.key))).toEqual([
      [key('a'), key('b')],
      [key('c'), key('d')],
    ])
  })

  it('leaves a lone cover out of any pack: a device fetches it alone anyway', () => {
    const plan = planCoverPacks(new Map([[key('a'), 10]]), [], everything, 100)
    expect(plan.groups).toEqual([])
  })

  it('makes nothing again when nothing has changed, short tail and all', () => {
    const full = pack('1', [
      [key('a'), 60],
      [key('b'), 50],
    ])
    const tail = pack('2', [
      [key('c'), 20],
      [key('d'), 20],
    ])
    const live = new Map([
      [key('a'), 60],
      [key('b'), 50],
      [key('c'), 20],
      [key('d'), 20],
    ])
    const plan = planCoverPacks(live, [full, tail], everything, 100)
    expect(plan.kept).toEqual([full, tail])
    expect(plan.groups).toEqual([])
  })

  it('makes the tail again with a new cover, and keeps the full pack as it is', () => {
    const full = pack('1', [
      [key('a'), 60],
      [key('b'), 50],
    ])
    const tail = pack('2', [
      [key('c'), 20],
      [key('d'), 20],
    ])
    const live = new Map([
      [key('a'), 60],
      [key('b'), 50],
      [key('c'), 20],
      [key('d'), 20],
      [key('e'), 10],
    ])
    const plan = planCoverPacks(live, [full, tail], everything, 100)
    expect(plan.kept).toEqual([full])
    expect(plan.groups.map(group => group.map(cover => cover.key))).toEqual([
      [key('c'), key('d'), key('e')],
    ])
  })

  it('keeps a full pack while half of it is still the library’s, and makes it again after', () => {
    const full = pack('1', [
      [key('a'), 50],
      [key('b'), 30],
      [key('c'), 20],
    ])
    // `c` gone: 80 of 100 bytes still live.
    const most = new Map([
      [key('a'), 50],
      [key('b'), 30],
    ])
    expect(planCoverPacks(most, [full], everything, 100)).toEqual({ kept: [full], groups: [] })

    // `a` gone too: 30 of 100. Its live covers are packed again with the rest.
    const little = new Map([
      [key('b'), 30],
      [key('z'), 5],
    ])
    const plan = planCoverPacks(little, [full], everything, 100)
    expect(plan.kept).toEqual([])
    expect(plan.groups.map(group => group.map(cover => cover.key))).toEqual([[key('b'), key('z')]])
  })

  it('drops a pack none of whose covers the library names', () => {
    const old = pack('1', [
      [key('a'), 10],
      [key('b'), 10],
    ])
    expect(planCoverPacks(new Map(), [old], everything, 100)).toEqual({ kept: [], groups: [] })
  })

  it('keeps a pack it could not make again, and packs only what it can read', () => {
    // Taken on from the bucket, with none of its covers on this server.
    const taken = pack('1', [
      [key('a'), 10],
      [key('b'), 10],
    ])
    const live = new Map([
      [key('a'), 10],
      [key('b'), 10],
      [key('c'), 10],
      [key('d'), 10],
      [key('e'), 10],
    ])
    const plan = planCoverPacks(live, [taken], k => k !== key('a') && k !== key('e'), 100)
    expect(plan.kept).toEqual([taken])
    expect(plan.groups.map(group => group.map(cover => cover.key))).toEqual([[key('c'), key('d')]])
  })

  it('counts a cover in two packs in the first', () => {
    const first = pack('1', [
      [key('a'), 60],
      [key('b'), 60],
    ])
    const second = pack('2', [
      [key('b'), 60],
      [key('c'), 60],
    ])
    const live = new Map([
      [key('a'), 60],
      [key('b'), 60],
      [key('c'), 60],
    ])
    // The second's live share, less `b`, is 60 of 120: kept.
    const plan = planCoverPacks(live, [first, second], everything, 100)
    expect(plan.kept).toEqual([first, second])
    expect(plan.groups).toEqual([])
  })
})
