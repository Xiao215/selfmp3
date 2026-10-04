import { describe, expect, it } from 'vitest'
import { ApiError } from '@selfmp3/client'
import type { DescribeResult, Song, Tag, TidyChange, Understanding } from '@selfmp3/shared'
import {
  askable,
  describeNotes,
  exactTag,
  matchingTags,
  modelHop,
  onlyTags,
  parts,
  picksHere,
  serverHop,
  tickedAtFirst,
  tidyEdits,
  tidyHere,
  tidyBands,
  tidyParts,
  leftOutKey,
  suggestionsHere,
  tagIdsFor,
  took,
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

describe('askable', () => {
  it('offers to ask for a sentence, or for letters nothing matches', () => {
    expect(askable('calm piano', 3)).toBe(true)
    expect(askable('yoru', 13)).toBe(false)
    expect(askable('周杰倫的慢歌', 0)).toBe(true)
    expect(askable('ab', 0)).toBe(false)
  })
})

describe('matchingTags', () => {
  const more: Tag[] = [...TAGS, { id: 11, name: 'j-anime', hue: 321, songCount: 1 }]

  it('puts names that start with the letters first, then the bigger tags', () => {
    expect(matchingTags('j', more, []).map(tag => tag.name)).toEqual(['jpop', 'j-anime'])
    expect(matchingTags('pop', more, []).map(tag => tag.name)).toEqual(['jpop'])
  })

  it('leaves out the tags already chosen, and offers nothing for nothing typed', () => {
    expect(matchingTags('j', more, [9]).map(tag => tag.name)).toEqual(['j-anime'])
    expect(matchingTags('  ', more, [])).toEqual([])
  })

  it('knows a tag typed in full', () => {
    expect(exactTag(' JPOP ', more)?.id).toBe(9)
    expect(exactTag('jp', more)).toBeNull()
  })
})

describe('Settings’ Test', () => {
  it('says how long each leg took', () => {
    expect(took(24.4)).toBe('24 ms')
    expect(took(1340)).toBe('1.3 s')
    expect(serverHop({ ms: 24 })).toEqual({
      ok: true,
      line: 'This device reached your server in 24 ms',
    })
    expect(modelHop({ ok: true, model: 'sonnet', ms: 1300 }).line).toBe(
      'Your server reached the model (sonnet) in 1.3 s',
    )
  })

  it('reads a 404 as a server older than the app, not as a missing feature', () => {
    const hop = serverHop({ error: new ApiError(404, 'no such endpoint', 'not_found') })
    expect(hop.ok).toBe(false)
    expect(hop.line).toMatch(/older than this app/)
  })

  it('tells the device not reaching the server from the server not reaching the model', () => {
    expect(serverHop({ error: new ApiError(0, 'Failed to fetch', 'offline') }).line).toBe(
      'This device can’t reach your server.',
    )
    expect(
      modelHop({
        ok: false,
        failure: 'unreachable',
        message: 'Your server couldn’t reach the model.',
        detail: 'The model at http://127.0.0.1:8787/v1 did not answer: fetch failed',
      }),
    ).toEqual({
      ok: false,
      line: 'Your server couldn’t reach the model.',
      detail: 'The model at http://127.0.0.1:8787/v1 did not answer: fetch failed',
    })
  })
})

describe('Tidy up', () => {
  const song = (id: number, title: string, artist: string) =>
    ({ id, title, artist, album: '', albumArtist: '' }) as unknown as Song
  const change = (over: Partial<TidyChange>): TidyChange => ({
    key: 'k',
    field: 'artist',
    from: '',
    to: '',
    why: 'w',
    by: 'rule',
    songIds: [],
    ...over,
  })
  const songs = new Map([
    [11, song(11, 'オリオン - Orion', '薛之谦, 薛之谦')],
    [12, song(12, '演员', '薛之谦')],
  ])
  const onDevice = (serverId: number) => serverId + 10
  const changes = [
    change({ key: 'a', from: '薛之谦, 薛之谦', to: '薛之谦', songIds: [1, 2], why: 'Twice' }),
    change({ key: 't', field: 'title', from: 'オリオン - Orion', to: 'オリオン', songIds: [1] }),
    change({ key: 'm', from: 'Rokudenashi', to: 'ロクデナシ', songIds: [9], by: 'model' }),
  ]

  it('leaves out songs changed since the server looked, and songs not here', () => {
    const here = tidyHere(changes, onDevice, songs)
    // Song 12's artist is already right, and song 19 is not on this device.
    expect(here.map(h => [h.change.key, h.songIds])).toEqual([
      ['a', [11]],
      ['t', [11]],
    ])
  })

  it('makes one edit per song, and ticks only what a rule found', () => {
    const here = tidyHere(changes, onDevice, songs)
    expect(tidyEdits(here)).toEqual([
      { songId: 11, patch: { artist: '薛之谦', title: 'オリオン' } },
    ])
    expect([...tickedAtFirst([...here, { change: changes[2]!, songIds: [1] }])]).toEqual(['a', 't'])
  })

  it('bands what a rule found ahead of what the model guessed, each under its reasons', () => {
    const all = [{ change: changes[2]!, songIds: [19] }, ...tidyHere(changes, onDevice, songs)]
    expect(tidyBands(all).map(band => [band.by, band.reasons.map(reason => reason.why)])).toEqual([
      ['rule', ['Twice', 'w']],
      ['model', ['w']],
    ])
  })

  it('leaves a song out of a change, and undoes back to what each field was', () => {
    const here = [{ change: changes[0]!, songIds: [11, 12] }]
    const leftOut = new Set([leftOutKey('a', 12)])
    expect(tidyEdits(here, leftOut)).toEqual([{ songId: 11, patch: { artist: '薛之谦' } }])
    expect(tidyEdits(here, new Set(), true)).toEqual([
      { songId: 11, patch: { artist: '薛之谦, 薛之谦' } },
      { songId: 12, patch: { artist: '薛之谦, 薛之谦' } },
    ])
  })

  it('draws a change that only takes words out on one line, the later copy going', () => {
    const line = (from: string, to: string) =>
      tidyParts(from, to)
        ?.map(part => (part.kind === 'gone' ? `[${part.text}]` : part.text))
        .join('')
    expect(line('HOYO-MiX, HOYO-MiX', 'HOYO-MiX')).toBe('HOYO-MiX[, HOYO-MiX]')
    expect(
      line(
        'Yu-Peng Chen, HOYO-MiX, Yu-Peng Chen, Zach Huang',
        'Yu-Peng Chen, HOYO-MiX, Zach Huang',
      ),
    ).toBe('Yu-Peng Chen, HOYO-MiX, [Yu-Peng Chen, ]Zach Huang')
    expect(line('演员 (Official MV)', '演员')).toBe('演员[ (Official MV)]')
    expect(line('Jade Moon Upon a Sea of Clouds ,', 'Jade Moon Upon a Sea of Clouds')).toBe(
      'Jade Moon Upon a Sea of Clouds[ ,]',
    )
    expect(line('Vitaly Margulis, Frédéric Chopin', 'Vitaly Margulis')).toBe(
      'Vitaly Margulis[, Frédéric Chopin]',
    )
    // Another spelling puts words in: a rename, drawn old → new.
    expect(tidyParts('Rokudenashi', 'ロクデナシ')).toBeNull()
    expect(tidyParts('Hoyo-Mix', 'HOYO-MiX')).toBeNull()
  })
})
