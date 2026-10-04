import { describe, expect, it } from 'vitest'
import type { DescribeResult, Tag, Understanding } from '@selfmp3/shared'
import {
  describeNotes,
  onlyTags,
  parts,
  picksHere,
  suggestionsHere,
  tagIdsFor,
} from './smart.model'

const TAGS: Tag[] = [
  { id: 7, name: '古典', hue: 92, songCount: 20 },
  { id: 9, name: 'jpop', hue: 231, songCount: 87 },
]

const base: Understanding = {
  name: 'Calm',
  anyTags: [],
  artists: [],
  noTags: [],
  energy: { min: null, max: null },
  bpm: { min: null, max: null },
  words: null,
  loved: null,
  playedWithinDays: null,
  notPlayedWithinDays: null,
  addedWithinDays: null,
  size: null,
  brief: null,
}

describe('parts', () => {
  it('draws each part as a chip, a tag with its hue', () => {
    const understanding = {
      ...base,
      anyTags: ['古典'],
      artists: ['YOASOBI'],
      energy: { min: null, max: 0.44 },
      words: 'without' as const,
      notPlayedWithinDays: 7,
    }
    expect(parts(understanding, TAGS).map(part => [part.label, part.hue])).toEqual([
      ['古典', 92],
      ['YOASOBI', undefined],
      ['Calm · energy under 0.44', undefined],
      ['No words', undefined],
      ['Not played this week', undefined],
    ])
  })

  it('takes one part away and leaves the rest', () => {
    const understanding = { ...base, anyTags: ['古典', 'jpop'], words: 'with' as const }
    const [classical] = parts(understanding, TAGS)
    expect(classical!.without(understanding)).toEqual({ ...understanding, anyTags: ['jpop'] })
  })
})

describe('onlyTags', () => {
  it('is true for tags and nothing else', () => {
    expect(onlyTags({ ...base, anyTags: ['jpop'] })).toBe(true)
    expect(onlyTags({ ...base, anyTags: ['jpop'], words: 'with' })).toBe(false)
    expect(onlyTags({ ...base, anyTags: ['jpop'], brief: 'for running' })).toBe(false)
    expect(onlyTags(base)).toBe(false)
  })
})

describe('picksHere', () => {
  it('turns server ids into this device’s, leaving out songs it lacks', () => {
    const onDevice = (id: number) => ({ 812: 47, 813: 48 })[id]
    const result = {
      picks: [
        { songId: 812, why: 'calm' },
        { songId: 999, why: null },
        { songId: 813, why: null },
      ],
    }
    expect(picksHere(result, onDevice)).toEqual([
      { songId: 47, why: 'calm' },
      { songId: 48, why: null },
    ])
  })
})

describe('describeNotes', () => {
  it('says what fit, what it let go of, and what the library lacks', () => {
    const result: DescribeResult = {
      understanding: base,
      fit: 40,
      loosened: ['the energy'],
      unknown: ['Lo-fi'],
      picks: [],
    }
    expect(describeNotes(result, 25)).toEqual([
      'Picked 25 of the 40 that fit',
      'Nothing fit all of it, so it let go of the energy.',
      'Your library has no Lo-fi.',
    ])
  })
})

describe('suggestionsHere', () => {
  it('finds the tag here by name, and drops a suggestion with no song here', () => {
    const onDevice = (id: number) => (id === 1 ? 101 : undefined)
    const suggestion = (tag: string, songIds: number[]) => ({
      tag,
      isNew: false,
      songIds,
      who: 'x',
      why: 'y',
      from: 'model' as const,
    })
    const here = suggestionsHere(
      [suggestion('JPOP', [1, 2]), suggestion('古典', [2])],
      onDevice,
      TAGS,
    )
    expect(here).toEqual([{ suggestion: suggestion('JPOP', [1, 2]), songIds: [101], tag: TAGS[1] }])
  })
})

describe('tagIdsFor', () => {
  it('matches names whatever their case', () => {
    expect(tagIdsFor(['JPop', 'none'], TAGS)).toEqual([9])
  })
})
