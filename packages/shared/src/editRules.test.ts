import { describe, expect, it } from 'vitest'
import {
  inKeptOrder,
  insertedAt,
  newTagHue,
  noSongsProblem,
  playlistSongsProblem,
  tagFlips,
  tagNamed,
  tagRenameProblem,
} from './editRules.js'
import { hueFromString } from './format.js'
import { playlistPatchProblem } from './schemas/playlist.js'

/**
 * The rules a server's routes and a device's cloud library both hold an edit
 * to. Each answerer has its own tests of what it does with them; these say
 * what the rules are.
 */

const RULES = { match: 'all', rules: [], orderBy: 'addedAt', order: 'desc', limit: null }

describe('playlistPatchProblem', () => {
  it('lets a live playlist change its rules, and anything else be edited on either kind', () => {
    expect(playlistPatchProblem('live', { rules: RULES })).toBeNull()
    expect(playlistPatchProblem('live', {})).toBeNull()
    expect(playlistPatchProblem('manual', { rules: null })).toBeNull()
  })

  it('refuses rules on a manual playlist, and taking a live one’s away', () => {
    expect(playlistPatchProblem('manual', { rules: RULES })).toMatchObject({
      status: 400,
      message: 'a manual playlist cannot have rules',
    })
    expect(playlistPatchProblem('live', { rules: null })).toMatchObject({
      status: 400,
      code: 'bad_request',
      message: expect.stringMatching(/stop following it instead/),
    })
  })
})

describe('playlist songs', () => {
  it('go in and out of a manual playlist only, and need one song that exists', () => {
    expect(playlistSongsProblem('manual')).toBeNull()
    expect(playlistSongsProblem('live')?.message).toMatch(/builds itself/)
    expect(noSongsProblem(2)).toBeNull()
    expect(noSongsProblem(0)?.message).toBe('none of those songs exist')
  })

  it('are put in at a place, clamped to the list, without moving ones already there', () => {
    expect(insertedAt([1, 2, 3], [9, 2, 9], 1)).toEqual([1, 9, 2, 3])
    expect(insertedAt([1, 2], [9], 40)).toEqual([1, 2, 9])
    expect(insertedAt([1, 2], [9], -3)).toEqual([9, 1, 2])
  })

  it('follow a rule in the order kept by hand, with the ones it found since at the end', () => {
    expect(inKeptOrder([], ['a', 'b'])).toEqual(['a', 'b'])
    // `x` stopped matching and keeps its place silently; `d` is new.
    expect(inKeptOrder(['c', 'x', 'a'], ['a', 'b', 'c', 'd'])).toEqual(['c', 'a', 'b', 'd'])
  })
})

describe('tags', () => {
  const tags = [
    { id: 1, name: 'chill' },
    { id: 2, name: 'Rain' },
  ]

  it('are told apart by name as the database does, ignoring the case of A–Z only', () => {
    expect(tagNamed(tags, 'RAIN')?.id).toBe(2)
    expect(tagNamed(tags, 'rain ')).toBeNull()
    expect(tagNamed([{ id: 3, name: 'Été' }], 'éTÉ')).toBeNull()
  })

  it('cannot be renamed to another tag’s name, but can to their own in another case', () => {
    expect(tagRenameProblem(tags, 1, 'rain')).toEqual({
      status: 409,
      code: 'conflict',
      message: 'a tag called "rain" already exists',
    })
    expect(tagRenameProblem(tags, 2, 'RAIN')).toBeNull()
    expect(tagRenameProblem(tags, 1, undefined)).toBeNull()
  })

  it('take the colour asked for, or the one their name always gives', () => {
    expect(newTagHue('Chill', 40)).toBe(40)
    expect(newTagHue('Chill', undefined)).toBe(hueFromString('chill'))
  })

  it('set on a song all at once are the ones that go on and the ones that come off', () => {
    expect(tagFlips([1, 2, 3], [3, 4, 4])).toEqual({ on: [4], off: [1, 2] })
    expect(tagFlips([1], [1])).toEqual({ on: [], off: [] })
  })
})
