import { describe, expect, it } from 'vitest'
import type { AskObject, Song, Stats } from '@selfmp3/shared'
import { askTools, libraryOf, type AskDeps, type AskToolName } from './askTools.js'
import { scriptedLlm, song, SONGS, TAGS } from './fixtures/library.js'
import { Remembered, type Llm } from './llm.js'
import type { Held } from './scope.js'
import { WorkingSet } from './workingSet.js'

const NOW = Date.parse('2026-10-27T12:00:00Z')

/** What an earlier answer showed, as the device sends it back. */
function object(handle: string, songIds: number[], label = 'Shown'): AskObject {
  return {
    handle,
    kind: 'songs',
    label,
    songIds,
    why: songIds.map(() => null),
    playlist: null,
    lead: 'play',
    like: null,
    understanding: null,
  }
}

const STATS = {
  range: 'all',
  totals: {
    plays: 9,
    minutes: 30.4,
    songsPlayed: 3,
    librarySize: 17,
    libraryMinutes: 56,
    neverPlayed: 14,
  },
  streakDays: 2,
  longestStreakDays: 5,
  daily: [],
  hourly: [],
  topArtists: [
    { key: 'YOASOBI', plays: 5, minutes: 16 },
    { key: '周杰倫', plays: 3, minutes: 10 },
  ],
  topTags: [{ key: 'jpop', plays: 5, minutes: 16 }],
  topSongs: [
    { songId: 7, title: 'アイドル', artist: 'YOASOBI', hasArt: false, plays: 5, minutes: 16 },
    { songId: 14, title: '七里香', artist: '周杰倫', hasArt: false, plays: 3, minutes: 10 },
    {
      songId: 4,
      title: 'Dream Aria',
      artist: 'Yu-Peng Chen, HOYO-MiX',
      hasArt: false,
      plays: 1,
      minutes: 3,
    },
  ],
} as Stats

function depsWith(llm: Llm = scriptedLlm({}), more: Partial<AskDeps> = {}, songs = SONGS) {
  return {
    llm,
    songs: () => songs,
    tags: () => TAGS,
    // ヨルシカ is Yorushika's other name.
    artistNames: () => ({ artistNames: { yorushika: ['ヨルシカ'] }, artistNamesFound: [] }),
    lyrics: (query: string) => (query === '外婆' ? [{ songId: 15, line: '外婆的家' }] : []),
    stats: () => STATS,
    now: () => NOW,
    remembered: new Remembered(),
    playlists: () => [
      { name: 'gym', kind: 'manual' as const, rules: null, songIds: () => [7, 8] },
      { name: 'chill · chinese', kind: 'manual' as const, rules: null, songIds: () => [14] },
    ],
    ...more,
  }
}

const NOTHING: Held = { playing: undefined, objects: [] }

/** The tools over a fresh working set, and a way to call one as the model would. */
function toolsFor(
  deps: ReturnType<typeof depsWith> = depsWith(),
  held: Held = NOTHING,
  only?: readonly AskToolName[],
) {
  const set = new WorkingSet(libraryOf(deps), held)
  const tools = askTools(deps, set, { question: 'the question', only })
  // The result as the model reads it: JSON.
  const call = async (name: string, args: unknown) => {
    const found = tools.find(each => each.name === name)
    if (!found) throw new Error(`no tool ${name}`)
    const result: unknown = await found.run(found.parameters.parse(args) as never)
    return JSON.parse(JSON.stringify(result))
  }
  return { set, tools, call }
}

const ids = (songs: readonly Song[]) => songs.map(each => each.id)
const rowIds = (view: { rows: string[] }) => view.rows.map(row => Number(row.split('|')[0]))

describe('the working set', () => {
  const held: Held = {
    playing: SONGS[6],
    objects: [object('t1.1', [7, 8, 9], 'J-pop'), object('t1.2', [14, 15])],
    screen: 't1.1',
  }

  it('starts with the song playing, what earlier answers showed and the one on the screen', () => {
    const { set } = toolsFor(depsWith(), held)
    expect(ids(set.resolve({ set: 'playing' }).songs)).toEqual([7])
    expect(ids(set.resolve({ set: 't1.2' }).songs)).toEqual([14, 15])
    expect(ids(set.resolve({ set: 'screen' }).songs)).toEqual([7, 8, 9])
    expect(set.listing()).toEqual([
      '- playing: 1 song, the song playing (“アイドル” · YOASOBI)',
      '- t1.1: 3 songs, J-pop',
      '- t1.2: 2 songs, Shown',
      '- screen: 3 songs, on their screen: t1.1',
    ])
  })

  it('counts places within a set, once each, in the order named', () => {
    const { set } = toolsFor(depsWith(), held)
    expect(ids(set.resolve({ set: 't1.1', pick: [3, 1, 3] }).songs)).toEqual([9, 7])
    expect(ids(set.resolve({ set: 'screen', pick: [2] }).songs)).toEqual([8])
    expect(() => set.resolve({ set: 't1.1', pick: [4] })).toThrow('holds 3 songs')
    expect(() => set.resolve({ pick: [1] })).toThrow('name it too')
  })

  it('narrows a set by filters, and says when they leave none', () => {
    const { set } = toolsFor(depsWith(), held)
    expect(ids(set.resolve({ set: 't1.1', filters: { artist: ['YOASOBI'] } }).songs)).toEqual([
      7, 8,
    ])
    expect(set.resolve({ set: 't1.2', filters: { tags: ['jpop'] } }).emptiedBy).toBe(
      'tag jpop (left none of 2)',
    )
  })

  it('takes only ids it was shown or a set holds, and no set named as one it came with', () => {
    const { set } = toolsFor(depsWith(), held)
    expect(ids(set.resolve({ ids: [9, 7] }).songs)).toEqual([9, 7])
    expect(() => set.resolve({ ids: [16] })).toThrow('16 is not an id you were shown')
    expect(() => set.resolve({ set: 't1.1', ids: [7] })).toThrow('not both')
    expect(() => set.resolve({ set: 't9.9' })).toThrow('There is no set called “t9.9”')
    expect(() => set.put('t2.1', [], 'mine')).toThrow('choose another name')
    expect(() => set.put('playing', [], 'mine')).toThrow('choose another name')
  })

  it('has no song playing when nothing plays', () => {
    const { set } = toolsFor()
    expect(() => set.resolve({ set: 'playing' })).toThrow('Nothing is playing')
    expect(set.listing()).toEqual([])
  })
})

describe('find_songs', () => {
  it('finds an artist by another name or script, keeps the set and shows its rows', async () => {
    const { set, call } = toolsFor()
    const view = await call('find_songs', { as: 'a', artist: ['ヨルシカ'] })
    expect(view).toMatchObject({ set: 'a', count: 2, minutes: 7 })
    expect(rowIds(view)).toEqual([9, 13])
    expect(view.rows[0]).toBe('9|アポリア|Yorushika|second person|2023|jpop|0.70|3:20|0')
    expect(view.emptiedBy).toBeUndefined()
    expect(ids(set.songsOf('a'))).toEqual([9, 13])
    // Simplified for the traditional the library writes.
    expect(rowIds(await call('find_songs', { as: 'b', artist: ['周杰伦'] }))).toEqual([14, 15, 16])
  })

  it('says which name matched nothing and the names nearest it, and never widens', async () => {
    const { call } = toolsFor()
    const view = await call('find_songs', { as: 'a', artist: ['Yorushkia'], tags: ['jpop'] })
    expect(view.count).toBe(0)
    expect(view.emptiedBy).toBe('artist Yorushkia (not in the library) (left none of 17)')
    expect(view.unmatched).toEqual([
      { kind: 'artist', name: 'Yorushkia', didYouMean: ['Yorushika'] },
    ])
  })

  it('says which condition emptied the songs', async () => {
    const { call } = toolsFor()
    const view = await call('find_songs', { as: 'a', artist: ['YOASOBI'], year: { min: 2030 } })
    expect(view).toMatchObject({ count: 0, emptiedBy: 'year 2030–… (left none of 2)' })
    const sung = await call('find_songs', { as: 'b', lyrics: '外婆' })
    expect(rowIds(sung)).toEqual([15])
  })

  it('sorts, keeps the first few, and starts from a set it made', async () => {
    const { call } = toolsFor()
    const loud = await call('find_songs', {
      as: 'loud',
      tags: ['古典'],
      sort: 'energy',
      order: 'desc',
      limit: 2,
    })
    expect(rowIds(loud)).toEqual([3, 2])
    const within = await call('find_songs', {
      as: 'raindrop',
      scope: { set: 'loud' },
      title: 'raindrop',
    })
    expect(rowIds(within)).toEqual([2])
  })

  it('shows at most 30 rows, and the rest from an offset', async () => {
    const many = Array.from({ length: 40 }, (_, index) => song(index + 1))
    const { set, call } = toolsFor(depsWith(scriptedLlm({}), {}, many))
    const first = await call('find_songs', { as: 'all' })
    expect(first).toMatchObject({ count: 40, more: 10, nextOffset: 30 })
    expect(first.rows).toHaveLength(30)
    expect(set.allowed(31)).toBe(true)
    const rest = await call('find_songs', { as: 'all', offset: 30 })
    expect(rowIds(rest)).toEqual(Array.from({ length: 10 }, (_, index) => index + 31))
  })
})

describe('count_by, listening and lookup_names', () => {
  it('counts a song once for each artist, and an artist written twice in one credit once', async () => {
    const { call } = toolsFor()
    const artists = await call('count_by', { by: 'artist' })
    expect(artists.songs).toBe(17)
    expect(artists.groups).toContainEqual({ name: '周杰倫', songs: 3 })
    expect(artists.groups).toContainEqual({ name: 'HOYO-MiX', songs: 4 })
    const albums = await call('count_by', {
      by: 'album',
      scope: { filters: { artist: ['周杰倫'] } },
    })
    expect(albums.groups).toEqual([
      { name: '七里香 — 周杰倫', songs: 2 },
      { name: '葉惠美 — 周杰倫, 周杰倫', songs: 1 },
    ])
  })

  it('reads the listening, within a scope too, and the songs it shows may be named', async () => {
    const { set, call } = toolsFor()
    expect(await call('listening', { range: 'all', about: 'totals' })).toMatchObject({
      plays: 9,
      minutes: 30,
      neverPlayed: 14,
    })
    const songs = await call('listening', {
      range: 'all',
      about: 'songs',
      scope: { filters: { artist: ['YOASOBI', '周杰倫'] } },
    })
    expect(songs.songs).toEqual(['7|アイドル|YOASOBI|5', '14|七里香|周杰倫|3'])
    expect(set.allowed(14)).toBe(true)
    expect(set.allowed(4)).toBe(false)
    const artists = await call('listening', {
      range: 'all',
      about: 'artists',
      scope: { filters: { tags: ['原神纯音乐'] } },
    })
    expect(artists.artists).toEqual([
      { name: 'HOYO-MiX', plays: 1 },
      { name: 'Yu-Peng Chen', plays: 1 },
    ])
  })

  it('finds the names the library spells, by other names and slips', async () => {
    const { call } = toolsFor()
    expect((await call('lookup_names', { kind: 'artist', query: 'ヨルシカ' })).matches[0]).toEqual({
      name: 'Yorushika',
      songs: 2,
      also: ['ヨルシカ'],
    })
    expect((await call('lookup_names', { kind: 'album', query: 'qilixiang' })).matches).toEqual([
      { name: '七里香', songs: 2 },
    ])
    expect(
      (await call('lookup_names', { kind: 'playlist', query: 'chill chinese' })).matches,
    ).toEqual([{ name: 'chill · chinese', songs: 1 }])
  })
})

describe('the tools that ask a model', () => {
  it('picks from a set, and an empty pick is an empty set with the reason', async () => {
    const llm = scriptedLlm({
      'describe-pick': [{ picks: [{ n: 1, why: 'calm piano' }] }, { picks: [] }],
    })
    const { set, call } = toolsFor(depsWith(llm))
    await call('find_songs', { as: 'chopin', tags: ['古典'] })
    const picked = await call('pick_by_taste', {
      as: 'calm',
      from: { set: 'chopin' },
      brief: 'calm',
      count: 1,
    })
    expect(picked.count).toBe(1)
    expect(picked.rows[0]).toMatch(/\|calm piano$/)
    expect([1, 2, 3]).toContain(set.songsOf('calm')[0]!.id)
    expect(llm.asked[0]!.prompt).toContain('Choose up to 1 songs.')

    const none = await call('pick_by_taste', {
      as: 'loud',
      from: { set: 'chopin' },
      brief: 'heavy metal',
    })
    expect(none).toMatchObject({ count: 0, emptiedBy: 'the pick chose none of them' })
    expect(none.notes).toContain('None of the 3 songs that fit seemed to be “heavy metal”.')
    expect(set.songsOf('loud')).toEqual([])
  })

  it('looks for a half-remembered song', async () => {
    const llm = scriptedLlm({ 'ask-find': [{ picks: [{ n: 1, why: 'about grandma' }] }] })
    const { call } = toolsFor(depsWith(llm))
    const found = await call('find_half_remembered', {
      as: 'it',
      terms: ['外婆', 'grandma'],
      brief: 'a song about grandma',
    })
    expect(found.rows).toEqual(['15|外婆|周杰倫|七里香|-|-|0.70|3:20|0|about grandma'])
  })

  it('keeps a proposal under its name, made over the scope', async () => {
    const llm = scriptedLlm({
      'tags-plan': [
        {
          checkup: false,
          ops: [{ op: 'rename', tag: 'jpop', to: 'J-pop', why: 'as written' }],
          focus: [],
          newTag: null,
          songs: 'none',
          artists: [],
        },
      ],
      'tidy-names': [{ spellings: [], credits: [], albums: [] }],
    })
    const { set, call } = toolsFor(depsWith(llm), { playing: SONGS[15], objects: [] })
    const tags = await call('propose_tags', { as: 'renamed', request: 'call jpop J-pop' })
    expect(tags).toMatchObject({ proposal: 'renamed', changes: 1, list: ['rename jpop → J-pop'] })
    expect(set.proposal('renamed')?.kind).toBe('tags')

    const names = await call('propose_names', {
      as: 'fixed',
      what: 'checkup',
      request: 'check this one',
      scope: { set: 'playing' },
    })
    expect(names).toMatchObject({ proposal: 'fixed', looked: 1 })
    expect(set.proposal('fixed')?.kind).toBe('tidy')
    await expect(
      call('propose_names', {
        as: 'x',
        what: 'checkup',
        request: 'r',
        scope: { set: 'playing', filters: { tags: ['jpop'] } },
      }),
    ).rejects.toThrow('The scope holds no songs.')
  })
})

describe('album_tracks', () => {
  const music = {
    albums: async (words: string) =>
      words.startsWith('七里香')
        ? [
            {
              id: 'live',
              url: 'u1',
              title: '七里香 (Live)',
              artist: '周杰倫',
              tracks: 12,
              cover: null,
            },
            { id: 'one', url: 'u2', title: '七里香', artist: '周杰倫', tracks: 3, cover: null },
          ]
        : [],
    albumTracks: async (id: string) =>
      id === 'one'
        ? ['七里香', '外婆', '借口'].map(title => ({
            title,
            artist: '周杰倫',
            album: '七里香',
            duration: 200,
            url: 'u',
            thumbnail: null,
          }))
        : [],
    songs: async () => [],
  }

  it('says which of an album’s tracks they have and which they lack', async () => {
    const { set, call } = toolsFor(depsWith(scriptedLlm({}), { music }))
    const [album, missing] = await call('album_tracks', {
      albums: [{ album: '七里香', artist: '周杰倫' }, { album: 'Nothing like it' }],
    })
    expect(album).toEqual({
      asked: '七里香',
      album: '七里香',
      artist: '周杰倫',
      tracks: 3,
      have: 2,
      theirs: ['14|七里香', '15|外婆'],
      lacking: ['借口'],
      others: ['七里香 (Live) — 周杰倫 (12 tracks)'],
    })
    expect(missing).toEqual({ asked: 'Nothing like it', found: null })
    expect(set.allowed(15)).toBe(true)
  })

  it('counts a track theirs when only the script of its title differs', async () => {
    const theirs = song(50, {
      title: '聽媽媽的話',
      artist: '周杰倫',
      album: '依然范特西',
      duration: 266,
    })
    const listed = {
      albums: async () => [
        { id: 'fantasy', url: 'u', title: '依然范特西', artist: '周杰伦', tracks: 2, cover: null },
      ],
      albumTracks: async () =>
        ['听妈妈的话', '千里之外'].map(title => ({
          title,
          artist: '周杰伦',
          album: '依然范特西',
          duration: 265,
          url: 'u',
          thumbnail: null,
        })),
      songs: async () => [],
    }
    const { call } = toolsFor(depsWith(scriptedLlm({}), { music: listed }, [...SONGS, theirs]))
    const [album] = await call('album_tracks', { albums: [{ album: '依然范特西' }] })
    expect(album).toMatchObject({ have: 1, theirs: ['50|聽媽媽的話'], lacking: ['千里之外'] })
  })

  it('is not offered when 网易云 cannot be reached', () => {
    const { tools } = toolsFor()
    expect(tools.map(each => each.name)).not.toContain('album_tracks')
    expect(tools.map(each => each.name)).not.toContain('catalogue')
  })
})
