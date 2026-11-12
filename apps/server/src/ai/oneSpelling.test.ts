import { describe, expect, it } from 'vitest'
import { scriptedLlm, song } from './fixtures/library.js'
import { inTheirLanguage } from './askedTidy.js'
import { nameGroups, oneSpelling } from './oneSpelling.js'

describe('tidy, one artist under more than one name', () => {
  const songs = [
    song(1, { title: '春泥棒', artist: 'Yorushika', album: '創作' }),
    song(2, { title: 'ただ君に晴れ', artist: 'Yorushika' }),
    song(3, { title: '又三郎', artist: 'ヨルシカ', album: 'Magic Lantern' }),
    song(4, { title: 'また夏を追う', artist: 'Atarayo' }),
    song(5, { title: '10月無口な君を忘れる', artist: 'あたらよ', albumArtist: 'あたらよ' }),
    song(6, { title: 'スパークル', artist: '幾田りら' }),
    song(7, { title: '恋風 - Koikaze', artist: 'Lilas' }),
    song(8, { title: 'Idol', artist: 'YOASOBI, Lilas' }),
    song(9, { title: 'Lemon', artist: '米津玄師' }),
  ]
  const spellings = new Map([
    ['ヨルシカ', ['yorushika']],
    ['あたらよ', ['atara yo']],
    ['幾田りら', ['iku ta ri ra']],
    ['米津玄師', ['mi jin xuan shi', 'yonezu kenshi']],
  ])
  const artistNames = { artistNames: { 幾田りら: ['ikura', 'Lilas'] }, artistNamesFound: [] }

  it('gathers the names that may be one artist across the whole library, and nothing else', () => {
    const groups = nameGroups(songs, artistNames, spellings)
    expect(groups.map(group => group.names.map(each => each.name))).toEqual([
      ['Yorushika', 'ヨルシカ'],
      ['Lilas', '幾田りら'],
      ['Atarayo', 'あたらよ'],
    ])
  })

  it('asks the model about those groups alone, and changes only names it was shown', async () => {
    const llm = scriptedLlm({
      'tidy-one': [
        {
          groups: [
            { g: 1, keep: 'ヨルシカ', from: ['Yorushika'], why: 'Their own name' },
            // Round in a circle, and a name kept that was never shown: neither is taken.
            { g: 1, keep: 'Yorushika', from: ['ヨルシカ'], why: 'Back again' },
            { g: 2, keep: 'Ikura', from: ['Lilas'], why: 'Not shown' },
            { g: 2, keep: '幾田りら', from: ['Lilas', 'Ikura'], why: 'Their own name' },
            { g: 3, keep: 'あたらよ', from: ['Atarayo'], why: 'Their own name' },
            { g: 9, keep: 'YOASOBI', from: ['米津玄師'], why: 'No such group' },
          ],
          say: '三位歌手的名字统一了。',
        },
      ],
    })
    const result = await oneSpelling(
      { llm, songs: () => songs, artistNames: () => artistNames, spellings: () => spellings },
      {
        text: 'some artists are in here twice under different names, fix that',
        songs,
        unknown: [],
        lookUp: false,
      },
    )
    expect(result.changes.map(each => [each.field, each.from, each.to, each.songIds])).toEqual([
      ['artist', 'Yorushika', 'ヨルシカ', [1, 2]],
      ['artist', 'Atarayo', 'あたらよ', [4]],
      ['artist', 'Lilas', '幾田りら', [7]],
      ['artist', 'YOASOBI, Lilas', 'YOASOBI, 幾田りら', [8]],
    ])
    expect(llm.asked).toHaveLength(1)
    expect(llm.asked[0]!.prompt).toContain('ヨルシカ (1): 又三郎 · Magic Lantern')
    // Said in Chinese to an English request: the changes speak instead.
    expect(result.reply).toBeNull()
  })

  it('asks nothing when no name looks like another among the songs asked about', async () => {
    const llm = scriptedLlm({})
    const result = await oneSpelling(
      { llm, songs: () => songs, spellings: () => spellings },
      { text: 'fix the names', songs: [songs[8]!], unknown: [], lookUp: false },
    )
    expect(result).toMatchObject({ changes: [], looked: 1 })
    expect(llm.asked).toEqual([])
  })

  it('reads a reply as theirs only when it is written the way the request is', () => {
    expect(inTheirLanguage('fix my names', 'Done.')).toBe('Done.')
    expect(inTheirLanguage('fix yorushika and ヨルシカ', '已经统一了。')).toBeNull()
    expect(inTheirLanguage('把名字改成简体', '已经统一了。')).toBe('已经统一了。')
    expect(inTheirLanguage('fix my names', null)).toBeNull()
  })
})
