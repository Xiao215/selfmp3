import { describe, expect, it } from 'vitest'
import { ApiError } from '@selfmp3/client'
import type {
  DescribeResult,
  Playlist,
  Song,
  Tag,
  TagChange,
  TidyChange,
  Understanding,
} from '@selfmp3/shared'
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
  reviewBands,
  tidyParts,
  leftOutKey,
  swapTagInRules,
  tagChangesHere,
  tagSteps,
  tagIdsFor,
  took,
  yearLabel,
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
  year: { min: null, max: null },
  words: null,
  loved: null,
  playedWithinDays: null,
  notPlayedWithinDays: null,
  addedWithinDays: null,
  size: null,
  minutes: null,
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

  it('says a range of years the way it was likely asked for', () => {
    expect(yearLabel({ min: 2000, max: 2009 })).toBe('2000s')
    expect(yearLabel({ min: 2015, max: null })).toBe('Since 2015')
    expect(yearLabel({ min: null, max: 2009 })).toBe('Before 2010')
    expect(yearLabel({ min: null, max: 2012 })).toBe('Up to 2012')
    expect(yearLabel({ min: 2003, max: 2003 })).toBe('2003')
    expect(yearLabel({ min: 2012, max: 2016 })).toBe('2012–2016')
    expect(yearLabel({ min: null, max: null })).toBeNull()

    const nineties = { ...base, year: { min: 1990, max: 1999 } }
    const [chip] = parts(nineties, TAGS)
    expect(chip!.label).toBe('1990s')
    expect(chip!.without(nineties)).toEqual(base)
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
    const bands = reviewBands(all, each => each.change.why)
    expect(bands.map(band => [band.by, band.sections.map(section => section.title)])).toEqual([
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

describe('tag changes', () => {
  const tags: Tag[] = [
    { id: 1, name: '中文流行', hue: 85, songCount: 2 },
    { id: 2, name: 'jpop', hue: 231, songCount: 2 },
    { id: 3, name: 'chinese pop', hue: 10, songCount: 1 },
  ]
  const song = (id: number, tagIds: number[]) => ({ id, tagIds }) as unknown as Song
  const songs = [song(11, [1]), song(12, []), song(13, [2]), song(14, [2, 3])]
  const songsById = new Map(songs.map(each => [each.id, each]))
  const onDevice = (serverId: number) => serverId + 10
  const change = (over: Partial<TagChange>): TagChange => ({
    key: 'k',
    op: 'add',
    tag: '中文流行',
    isNew: false,
    to: null,
    songIds: [],
    who: 'w',
    why: 'y',
    by: 'model',
    ...over,
  })
  const live = (id: number, tagIds: number[]): Playlist =>
    ({
      id,
      kind: 'live',
      rules: {
        match: 'any',
        rules: tagIds.map(tagId => ({ field: 'tag', op: 'has', tagId })),
        orderBy: 'addedAt',
        order: 'desc',
        limit: null,
      },
    }) as unknown as Playlist

  it('keeps an add’s songs still without the tag, and a remove’s still with it', () => {
    const here = tagChangesHere(
      [
        change({ key: 'a', songIds: [1, 2] }),
        change({ key: 'r', op: 'remove', tag: 'JPOP', songIds: [1, 3] }),
        change({ key: 'n', tag: 'Mandopop', isNew: true, songIds: [2] }),
        change({ key: 'gone', op: 'delete', tag: 'Nope' }),
        change({ key: 'clash', op: 'rename', tag: 'jpop', to: '中文流行' }),
        change({ key: 'm', op: 'merge', tag: 'chinese pop', to: '中文流行' }),
      ],
      onDevice,
      songsById,
      tags,
    )
    expect(here.map(each => [each.change.key, each.songIds, each.tag?.id ?? null])).toEqual([
      ['a', [12], 1],
      ['r', [13], 2],
      ['n', [12], null],
      ['m', [], 3],
    ])
  })

  it('makes new tags first, then songs, renames, merges and deletes, with what Undo needs', () => {
    const here = tagChangesHere(
      [
        change({ key: 'd', op: 'delete', tag: 'jpop' }),
        change({ key: 'm', op: 'merge', tag: 'chinese pop', to: '中文流行' }),
        change({ key: 'n', tag: 'Mandopop', isNew: true, songIds: [2] }),
        change({ key: 'a', songIds: [2] }),
      ],
      onDevice,
      songsById,
      tags,
    )
    const steps = tagSteps(here, new Set(), songs, [live(5, [3, 1]), live(6, [2])])
    expect(steps).toEqual([
      { kind: 'make', name: 'Mandopop' },
      { kind: 'songs', action: 'add', tag: { name: 'Mandopop' }, songIds: [12] },
      { kind: 'songs', action: 'add', tag: { id: 1 }, songIds: [12] },
      {
        kind: 'merge',
        from: tags[2],
        into: tags[0],
        songIds: [14],
        gaining: [14],
        playlists: [{ id: 5, rules: expect.anything() }],
      },
      {
        kind: 'delete',
        tag: tags[1],
        songIds: [13, 14],
        playlists: [{ id: 6, rules: expect.anything() }],
      },
    ])
    // A song left out of an add is not given the tag.
    const leftOut = new Set([leftOutKey('a', 12)])
    expect(tagSteps(here, leftOut, songs, []).filter(step => step.kind === 'songs')).toHaveLength(1)
  })

  it('moves a playlist from a merged tag onto the one it goes into, once', () => {
    const playlist = live(5, [3, 1])
    if (playlist.kind !== 'live') throw new Error('not live')
    expect(swapTagInRules(playlist.rules, 3, 1).rules).toEqual([
      { field: 'tag', op: 'has', tagId: 1 },
    ])
  })
})
