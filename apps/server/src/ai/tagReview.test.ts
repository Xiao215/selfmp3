import { describe, expect, it } from 'vitest'
import type { Tag } from '@selfmp3/shared'
import { SONGS, TAGS, scriptedLlm } from './fixtures/library.js'
import { LlmError } from './llm.js'
import {
  fromLibrary,
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
  ...overrides,
})

const group = (g: string, overrides: Record<string, unknown> = {}) => ({
  g,
  add: [],
  remove: [],
  newTag: null,
  sure: 'high',
  why: 'Because',
  ...overrides,
})

describe('fromLibrary', () => {
  it('takes the tag every tagged song on the album shares', () => {
    expect(fromLibrary(byId(12), tagged, TAGS)).toEqual({
      tag: TAGS[0],
      why: 'The rest of Best of Chopin is in 古典',
    })
  })

  it('needs two of the artist’s songs before the artist decides', () => {
    // Yorushika has one tagged song: not enough to speak for another album.
    expect(fromLibrary(byId(13), tagged, TAGS)).toBeNull()
    const more = [...tagged, { ...byId(9), id: 99, album: 'Elma' }]
    expect(fromLibrary(byId(13), more, TAGS)?.tag.name).toBe('jpop')
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
      'g1 | 周杰倫 | 3 songs | no tags | titles in Chinese | albums: 七里香 2, 葉惠美 1',
    )
    expect(prompt).not.toContain('Grande valse')
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

describe('whoOf', () => {
  it('names the three biggest and counts the rest', () => {
    const songs = [byId(14), byId(15), byId(7), byId(9), byId(11)]
    expect(whoOf(songs)).toBe('周杰倫 2, Masaru Yokoyama 1, YOASOBI 1, +1 more')
  })
})
