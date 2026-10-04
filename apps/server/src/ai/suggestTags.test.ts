import { describe, expect, it } from 'vitest'
import { SONGS, TAGS, scriptedLlm } from './fixtures/library.js'
import { fromLibrary, suggestTags, whoOf } from './suggestTags.js'

const tagged = SONGS.filter(song => song.tagIds.length > 0)
const byId = (id: number) => SONGS.find(song => song.id === id)!

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

describe('suggestTags', () => {
  it('asks the model only about what the library cannot answer, and checks the answer', async () => {
    const llm = scriptedLlm({
      'suggest-tags': [
        {
          groups: [
            { g: 'g1', tags: ['中文流行'], newTag: null, sure: 'high', why: 'Mandarin pop' },
            { g: 'g2', tags: [], newTag: null, sure: 'low', why: 'Not sure' },
            {
              g: 'g4',
              tags: ['Made Up'],
              newTag: '枫丹',
              sure: 'medium',
              why: 'A region of the game',
            },
            { g: 'g9', tags: ['jpop'], newTag: null, sure: 'high', why: 'No such group' },
          ],
        },
      ],
    })

    const result = await suggestTags({ llm, songs: () => SONGS, tags: () => TAGS })

    expect(result.untagged).toBe(7)
    expect(result.suggestions).toEqual([
      {
        tag: '中文流行',
        isNew: false,
        songIds: [14, 15, 16],
        who: '周杰倫 3',
        why: 'Mandarin pop',
        from: 'model',
      },
      {
        tag: '古典',
        isNew: false,
        songIds: [12],
        who: 'Henrik Måwe',
        why: 'The rest of Best of Chopin is in 古典',
        from: 'library',
      },
      {
        tag: '枫丹',
        isNew: true,
        songIds: [17],
        who: 'HOYO-MiX',
        why: 'A region of the game',
        from: 'model',
      },
    ])
    expect(result.unsure.map(each => each.songIds)).toEqual([[11], [13]])

    // Groups by who the songs are mostly by: 周杰倫's three are one question.
    const prompt = llm.asked[0]!.prompt
    expect(prompt).toContain('g1 | 周杰倫 | 3 songs | albums: 七里香 2, 葉惠美 1')
    expect(prompt).not.toContain('Grande valse')
  })

  it('makes one row of a tag the library and the model both suggest', async () => {
    const llm = scriptedLlm({
      'suggest-tags': [
        { groups: [{ g: 'g2', tags: ['古典'], newTag: null, sure: 'high', why: 'Solo piano' }] },
      ],
    })
    const result = await suggestTags({ llm, songs: () => SONGS, tags: () => TAGS })
    const classical = result.suggestions.filter(each => each.tag === '古典')
    expect(classical).toEqual([expect.objectContaining({ songIds: [12, 11], from: 'model' })])
  })

  it('does not ask at all when the library answers for everything', async () => {
    const llm = scriptedLlm({})
    const songs = SONGS.filter(song => song.tagIds.length > 0 || song.id === 12)
    const result = await suggestTags({ llm, songs: () => songs, tags: () => TAGS })
    expect(result.suggestions.map(each => each.tag)).toEqual(['古典'])
    expect(llm.asked).toHaveLength(0)
  })
})

describe('whoOf', () => {
  it('names the three biggest and counts the rest', () => {
    const songs = [byId(14), byId(15), byId(7), byId(9), byId(11)]
    expect(whoOf(songs)).toBe('周杰倫 2, Masaru Yokoyama 1, YOASOBI 1, +1 more')
  })
})
