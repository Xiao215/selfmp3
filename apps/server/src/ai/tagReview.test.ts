import { describe, expect, it } from 'vitest'
import type { Tag } from '@selfmp3/shared'
import { SONGS, TAGS, scriptedLlm, song } from './fixtures/library.js'
import { LlmError } from './llm.js'
import {
  callsOf,
  placeFromLibrary,
  groupSongs,
  missingFromAlbum,
  sameNames,
  scriptOf,
  tagReview,
  whoOf,
} from './tagReview.js'

const tagged = SONGS.filter(song => song.tagIds.length > 0)
const byId = (id: number) => SONGS.find(song => song.id === id)!

const plan = (overrides: Record<string, unknown>) => ({
  checkup: false,
  ops: [],
  focus: [],
  newTag: null,
  songs: 'none',
  artists: [],
  from: null,
  ...overrides,
})

const group = (g: string, overrides: Record<string, unknown> = {}) => ({
  g,
  songs: [],
  add: [],
  remove: [],
  newTag: null,
  sure: 'high',
  why: 'Because',
  ...overrides,
})

describe('placeFromLibrary', () => {
  it('takes the tag every tagged song on the album shares', () => {
    expect(placeFromLibrary(tagged, TAGS)(byId(12))).toEqual({
      tag: TAGS[0],
      why: 'The rest of Best of Chopin is in 古典',
    })
  })

  it('needs two of the artist’s songs before the artist decides', () => {
    // Yorushika has one tagged song: not enough to speak for another album.
    expect(placeFromLibrary(tagged, TAGS)(byId(13))).toBeNull()
    const more = [...tagged, { ...byId(9), id: 99, album: 'Elma' }]
    expect(placeFromLibrary(more, TAGS)(byId(13))?.tag.name).toBe('jpop')
  })
})

describe('missingFromAlbum', () => {
  it('names a tag every other song on the album carries', () => {
    const left = { ...byId(3), tagIds: [2] }
    const album = [byId(1), byId(2), left]
    expect(missingFromAlbum(left, album)).toEqual([1])
    // One other song is not the album speaking.
    expect(missingFromAlbum(left, [byId(1), left])).toEqual([])
  })
})

describe('sameNames', () => {
  it('merges each spelling of one name into the biggest', () => {
    const tags: Tag[] = [...TAGS, { id: 5, name: 'J-POP', hue: 1, songCount: 0 }]
    expect(sameNames(tags)).toEqual([{ tag: tags[4], into: TAGS[2] }])
  })
})

describe('groupSongs', () => {
  it('splits an artist by what the songs carry and the script of their titles', () => {
    const songs = [
      byId(14),
      byId(15),
      { ...byId(16), title: 'Mojito', tagIds: [] },
      { ...byId(15), id: 30, tagIds: [4] },
    ]
    const groups = groupSongs(songs)
    expect(groups.map(each => [each.script, each.songs.map(song => song.id)])).toEqual([
      ['Chinese', [14, 15]],
      ['Latin', [16]],
      ['Chinese', [30]],
    ])
  })

  it('reads a title’s script', () => {
    expect(scriptOf('夜に駆ける')).toBe('Japanese')
    expect(scriptOf('晴天')).toBe('Chinese')
    expect(scriptOf('Always Online')).toBe('Latin')
  })
})

describe('tagReview, the untagged songs', () => {
  it('asks the model only about what the library cannot place, and checks the answer', async () => {
    const llm = scriptedLlm({
      'tags-groups': [
        {
          groups: [
            group('g1', { add: ['中文流行'], why: 'Mandarin pop' }),
            group('g2', { sure: 'low', why: 'Not sure' }),
            group('g4', { add: ['Made Up'], newTag: '枫丹', sure: 'medium', why: 'A region' }),
            group('g9', { add: ['jpop'], why: 'No such group' }),
          ],
        },
      ],
    })

    const result = await tagReview({ llm, songs: () => SONGS, tags: () => TAGS }, { text: null })

    expect(result.looked).toBe(7)
    expect(result.changes).toEqual([
      expect.objectContaining({
        op: 'add',
        tag: '古典',
        songIds: [12],
        who: 'Henrik Måwe',
        why: 'The rest of Best of Chopin is in 古典',
        by: 'rule',
      }),
      expect.objectContaining({
        op: 'add',
        tag: '中文流行',
        isNew: false,
        songIds: [14, 15, 16],
        who: '周杰倫 3',
        by: 'model',
      }),
      expect.objectContaining({ op: 'add', tag: '枫丹', isNew: true, songIds: [17] }),
    ])
    expect(result.unsure.map(each => each.songIds)).toEqual([[11], [13]])
    // No request, so no plan: the one call is about the songs.
    expect(llm.asked.map(each => each.task)).toEqual(['tags-groups'])
    const prompt = llm.asked[0]!.prompt
    expect(prompt).toContain(
      'g1 | 周杰倫 | 3 songs | no tags | titles in Chinese | 1 七里香 (七里香); 2 外婆 (七里香); 3 晴天 (葉惠美)',
    )
    expect(prompt).not.toContain('Grande valse')
  })

  it('changes as many songs as were asked for, the library’s first', async () => {
    const llm = scriptedLlm({
      'tags-groups': [
        {
          groups: [
            group('g1', { add: ['中文流行'], why: 'Mandarin pop' }),
            group('g4', { newTag: '枫丹', sure: 'medium', why: 'A region' }),
          ],
        },
      ],
    })
    const result = await tagReview(
      { llm, songs: () => SONGS, tags: () => TAGS },
      { text: null, limit: 2 },
    )
    expect(result.changes.map(each => [each.tag, each.songIds, each.who])).toEqual([
      ['古典', [12], 'Henrik Måwe'],
      ['中文流行', [14], '周杰倫'],
    ])
    expect(result.note).toBe('Kept to 2 songs, as you asked. Ask again for more.')
  })

  it('asks the model nothing once the library has placed as many as were asked for', async () => {
    const llm = scriptedLlm({})
    const result = await tagReview(
      { llm, songs: () => SONGS, tags: () => TAGS },
      { text: null, limit: 1 },
    )
    expect(result.changes.map(each => each.songIds)).toEqual([[12]])
    expect(llm.asked).toEqual([])
    expect(result.note).toBeNull()
  })

  it('still gives the library’s own answers when the model cannot be asked', async () => {
    const llm = scriptedLlm({ 'tags-groups': [new LlmError('unreachable', 'down')] })
    const result = await tagReview({ llm, songs: () => SONGS, tags: () => TAGS }, { text: null })
    expect(result.changes.map(each => [each.tag, each.by])).toEqual([['古典', 'rule']])
    expect(result.note).toContain('couldn’t reach the model')
  })
})

describe('tagReview, a request', () => {
  it('looks at the songs without the tag and keeps only changes to it', async () => {
    const llm = scriptedLlm({
      'tags-plan': [plan({ focus: ['中文流行'], songs: 'without' })],
      'tags-groups': [
        {
          groups: [
            group('g1', { add: ['中文流行'], why: 'Mandarin pop' }),
            // Not the tag in question, and a tag the group does not carry.
            group('g4', { add: ['jpop'] }),
            group('g10', { remove: ['中文流行'] }),
          ],
        },
      ],
    })
    const result = await tagReview(
      { llm, songs: () => SONGS, tags: () => TAGS },
      { text: 'tag the songs that should be 中文流行' },
    )
    expect(result.changes).toEqual([
      expect.objectContaining({ op: 'add', tag: '中文流行', songIds: [14, 15, 16], by: 'model' }),
    ])
    expect(result.looked).toBe(16)
    expect(result.asked).toBe('tag the songs that should be 中文流行')
    const prompt = llm.asked[1]!.prompt
    expect(prompt).toContain('Tags in question: 中文流行')
    expect(prompt).toContain('No new tag may be made')
  })

  it('says it is unsure only of a change it would have made', async () => {
    const llm = scriptedLlm({
      'tags-plan': [plan({ focus: ['中文流行'], songs: 'without' })],
      'tags-groups': [
        {
          groups: [
            group('g1', { add: ['中文流行'], sure: 'low', why: 'Maybe' }),
            group('g2', { sure: 'low', why: 'Fine as it is' }),
          ],
        },
      ],
    })
    const result = await tagReview(
      { llm, songs: () => SONGS, tags: () => TAGS },
      { text: 'tag the songs that should be 中文流行' },
    )
    expect(result.changes).toEqual([])
    expect(result.unsure).toEqual([{ songIds: [14, 15, 16], who: '周杰倫 3', why: 'Maybe' }])
  })

  it('looks only at the artists the request names', async () => {
    const llm = scriptedLlm({
      'tags-plan': [plan({ focus: ['中文流行'], songs: 'without', artists: ['周杰倫'] })],
      'tags-groups': [{ groups: [group('g1', { add: ['中文流行'] })] }],
    })
    const result = await tagReview(
      { llm, songs: () => SONGS, tags: () => TAGS },
      { text: 'tag every 周杰倫 song 中文流行' },
    )
    expect(result.looked).toBe(3)
    expect(result.changes.map(each => each.songIds)).toEqual([[14, 15, 16]])
  })

  it('makes the one new tag the request names, and no other', async () => {
    const llm = scriptedLlm({
      'tags-plan': [plan({ newTag: 'Jay', songs: 'without', artists: ['周杰倫'] })],
      'tags-groups': [{ groups: [group('g1', { add: ['Jay', 'Other'], newTag: 'Nope' })] }],
    })
    const result = await tagReview(
      { llm, songs: () => SONGS, tags: () => TAGS },
      { text: 'make a tag Jay for 周杰倫' },
    )
    expect(result.changes).toEqual([
      expect.objectContaining({ op: 'add', tag: 'Jay', isNew: true, songIds: [14, 15, 16] }),
    ])
  })

  it('renames, merges and deletes only tags that exist, once each, without a clash', async () => {
    const llm = scriptedLlm({
      'tags-plan': [
        plan({
          ops: [
            { op: 'merge', tag: 'JPOP', to: '中文流行', why: 'Same thing' },
            { op: 'rename', tag: '古典', to: 'jpop', why: 'Clashes' },
            { op: 'rename', tag: '原神纯音乐', to: 'Genshin', why: 'Shorter' },
            { op: 'delete', tag: 'Nope', to: null, why: 'Not a tag' },
            { op: 'delete', tag: 'jpop', to: null, why: 'Merged already' },
          ],
        }),
      ],
    })
    const result = await tagReview(
      { llm, songs: () => SONGS, tags: () => TAGS },
      { text: 'rename 原神纯音乐 to Genshin and merge jpop into 中文流行' },
    )
    expect(result.changes).toEqual([
      expect.objectContaining({ op: 'rename', tag: '原神纯音乐', to: 'Genshin', by: 'model' }),
      expect.objectContaining({
        op: 'merge',
        tag: 'jpop',
        to: '中文流行',
        who: 'YOASOBI 2, Yorushika 1',
      }),
    ])
    // Only tags: no songs to look at, so no second call.
    expect(llm.asked).toHaveLength(1)
  })

  it('checks everything for a checkup: spellings of one tag, and songs placed by their album', async () => {
    const tags: Tag[] = [...TAGS, { id: 5, name: 'J-POP', hue: 1, songCount: 0 }]
    const llm = scriptedLlm({
      'tags-plan': [plan({ checkup: true })],
      'tags-groups': [{ groups: [] }],
    })
    const result = await tagReview(
      { llm, songs: () => SONGS, tags: () => tags },
      { text: 'tidy my tags' },
    )
    expect(result.changes.map(each => [each.op, each.tag, each.to, each.by])).toEqual([
      ['merge', 'J-POP', 'jpop', 'rule'],
      ['add', '古典', null, 'rule'],
    ])
    // Songs with no tag, and artists tagged more than one way; never the ones that agree.
    const groups = llm.asked[1]!.prompt.split('Groups (')[1]!
    expect(groups).toContain('| Yorushika | 1 song | tags: jpop |')
    expect(groups).not.toContain('YOASOBI')
  })
})

describe('tagReview, songs it points at and songs one by one', () => {
  it('looks at the song playing and no other, when the plan says the request points at it', async () => {
    const llm = scriptedLlm({
      'tags-plan': [plan({ focus: ['jpop'], songs: 'without', from: 'playing' })],
      'tags-groups': [{ groups: [group('g1', { add: ['jpop'] })] }],
    })
    const result = await tagReview(
      { llm, songs: () => SONGS, tags: () => TAGS },
      { text: 'tag this jpop', held: { playing: byId(13) } },
    )
    expect(result.looked).toBe(1)
    expect(result.changes).toEqual([
      expect.objectContaining({ op: 'add', tag: 'jpop', songIds: [13] }),
    ])
    expect(llm.asked[0]!.prompt).toContain(
      'Songs they may mean:\nplaying: Prostitution | Yorushika | Plagiarism | no tags',
    )
    expect(llm.asked[1]!.prompt).toContain('| Yorushika | 1 song | no tags |')
  })

  it('says nothing is playing rather than looking at the whole library', async () => {
    const llm = scriptedLlm({
      'tags-plan': [plan({ focus: ['jpop'], songs: 'without', from: 'playing' })],
    })
    const result = await tagReview(
      { llm, songs: () => SONGS, tags: () => TAGS },
      { text: 'tag this jpop', held: { playing: undefined } },
    )
    expect(result).toMatchObject({ changes: [], looked: 0, note: 'Nothing is playing to look at.' })
    expect(llm.asked.map(each => each.task)).toEqual(['tags-plan'])
  })

  it('takes a change for some of a group’s songs, each song once', async () => {
    const llm = scriptedLlm({
      'tags-plan': [plan({ focus: ['中文流行'], songs: 'without', artists: ['周杰倫'] })],
      'tags-groups': [
        {
          groups: [
            group('g1', { songs: [1, 3, 9], add: ['中文流行'], why: 'Mandarin' }),
            // Song 1 is answered already; a number the group lacks is no song.
            group('g1', { songs: [1], remove: [], add: ['jpop'] }),
            // The rest of the group: only song 2 is left.
            group('g1', { add: ['中文流行'], sure: 'low', why: 'Maybe' }),
          ],
        },
      ],
    })
    const result = await tagReview(
      { llm, songs: () => SONGS, tags: () => TAGS },
      { text: 'tag the 周杰倫 songs in Mandarin 中文流行' },
    )
    expect(result.changes).toEqual([
      expect.objectContaining({ op: 'add', tag: '中文流行', songIds: [14, 16], why: 'Mandarin' }),
    ])
    expect(result.unsure).toEqual([{ songIds: [15], who: '周杰倫', why: 'Maybe' }])
  })

  it('lists a big group in parts, and keeps each call to a bounded number of songs', () => {
    const many = Array.from({ length: 450 }, (_, at) =>
      song(1000 + at, { title: `曲 ${at}`, artist: 'HOYO-MiX' }),
    )
    const groups = groupSongs(many)
    expect(groups.map(each => each.songs.length)).toEqual([...Array(11).fill(40), 10])
    expect(callsOf(groups).map(call => call.reduce((n, each) => n + each.songs.length, 0))).toEqual(
      [400, 50],
    )
  })
})

describe('whoOf', () => {
  it('names the three biggest and counts the rest', () => {
    const songs = [byId(14), byId(15), byId(7), byId(9), byId(11)]
    expect(whoOf(songs)).toBe('周杰倫 2, Masaru Yokoyama 1, YOASOBI 1, +1 more')
  })
})
