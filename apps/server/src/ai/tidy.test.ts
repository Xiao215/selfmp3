import { describe, expect, it } from 'vitest'
import { scriptedLlm, song } from './fixtures/library.js'
import { LlmError } from './llm.js'
import { withoutRepeats, withoutTranslation, withoutUseNote } from '@selfmp3/shared'
import {
  couldBeOneName,
  inTheirLanguage,
  namesPrompt,
  nameGroups,
  oneSpelling,
  tidy,
  withoutArtistPrefix,
  withoutVideoWords,
} from './tidy.js'

describe('the rules', () => {
  it('says each name in a credit once', () => {
    expect(withoutRepeats('薛之谦, 薛之谦, 薛之谦')).toBe('薛之谦')
    expect(withoutRepeats('郭顶, 薛之谦, 薛之谦')).toBe('郭顶, 薛之谦')
    expect(withoutRepeats('Yu-Peng Chen, HOYO-MiX')).toBe('Yu-Peng Chen, HOYO-MiX')
  })

  it('takes the video’s words out of a title, and nothing else', () => {
    expect(withoutVideoWords('Idol (Official Music Video)')).toBe('Idol')
    expect(withoutVideoWords('【MV】夜に駆ける')).toBe('夜に駆ける')
    expect(withoutVideoWords('Song (Live at Budokan)')).toBe('Song (Live at Budokan)')
  })

  it('takes the artist off the front of a title', () => {
    expect(withoutArtistPrefix('YOASOBI - 夜に駆ける', 'YOASOBI')).toBe('夜に駆ける')
    expect(withoutArtistPrefix('Love - Live', 'Someone')).toBe('Love - Live')
  })

  it('keeps the original name and drops its English, but not a featured artist', () => {
    expect(withoutTranslation('オリオン - Orion')).toBe('オリオン')
    expect(withoutTranslation('すずめ - Suzume (feat. Toaka)')).toBe('すずめ (feat. Toaka)')
    expect(withoutTranslation('Love - Live')).toBe('Love - Live')
    expect(withoutTranslation('夜 - 朝')).toBe('夜 - 朝')
  })

  it('takes off a note on where the song was used, and nothing that is the song', () => {
    expect(withoutUseNote('有点甜 (《萌三国》网游主题曲|《微微一笑很倾城》电视剧插曲)')).toBe(
      '有点甜',
    )
    expect(withoutUseNote('光年之外（电影《太空旅客》中国区主题曲）')).toBe('光年之外')
    expect(withoutUseNote('Lemon（ドラマ「アンナチュラル」主題歌）')).toBe('Lemon')
    expect(withoutUseNote('Let It Go (From Frozen)')).toBe('Let It Go (From Frozen)')
    expect(withoutUseNote('夜に駆ける (Live)')).toBe('夜に駆ける (Live)')
    expect(withoutUseNote('Theme (Ending)')).toBe('Theme (Ending)')
    expect(withoutUseNote('(《主题曲》)')).toBe('(《主题曲》)')
  })

  it('tells one name written two ways from two people', () => {
    expect(couldBeOneName('ロクデナシ', 'Rokudenashi')).toBe(true)
    expect(couldBeOneName('G.E.M.', 'G.E.M. 鄧紫棋')).toBe(true)
    expect(couldBeOneName('周杰倫', '周杰伦')).toBe(true)
    expect(couldBeOneName('Hoyo-Mix', 'HOYO-MiX')).toBe(true)
    expect(couldBeOneName('Jura Margulis', 'Vitaly Margulis')).toBe(false)
  })
})

describe('tidy', () => {
  const songs = [
    song(1, { title: 'オリオン - Orion', artist: 'YOASOBI' }),
    song(2, { title: '演员', artist: '薛之谦, 薛之谦, 薛之谦' }),
    song(3, { title: '丑八怪', artist: '薛之谦, 薛之谦, 薛之谦' }),
    song(4, { title: 'Nocturne', artist: 'Vitaly Margulis, Frédéric Chopin' }),
    song(5, { title: 'Ballade', artist: 'Jura Margulis' }),
    song(6, { title: 'ただ君に晴れ', artist: 'Rokudenashi' }),
    song(7, { title: '知らないままで', artist: 'ロクデナシ' }),
    song(8, { title: 'Orion', artist: 'YOASOBI', album: 'THE BOOK ,' }),
  ]

  it('groups a change across its songs, and keeps what the model says to names it was shown', async () => {
    const llm = scriptedLlm({
      'tidy-names': [
        {
          spellings: [
            // Two people, not one: refused.
            { from: 'Jura Margulis', to: 'Vitaly Margulis', why: 'same pianist' },
            // Pointed at the romanisation: turned round to the artist's own script.
            { from: 'ロクデナシ', to: 'Rokudenashi', why: 'used more' },
            // A name the library does not have: refused.
            { from: 'Nobody', to: 'Somebody', why: 'x' },
            // A translation the library never uses: refused.
            { from: 'YOASOBI', to: 'ヨアソビ', why: 'own script' },
          ],
          credits: [
            { from: 'Vitaly Margulis, Frédéric Chopin', to: 'Vitaly Margulis', why: 'composer' },
          ],
          albums: [{ from: 'THE BOOK ,', to: 'THE BOOK', why: 'stray comma' }],
        },
      ],
    })
    const result = await tidy({ llm, songs: () => songs })
    const shown = result.changes.map(
      c => `${c.field}|${c.from}→${c.to}|${c.songIds.join(',')}|${c.by}`,
    )
    expect(shown).toEqual([
      'artist|薛之谦, 薛之谦, 薛之谦→薛之谦|2,3|rule',
      'artist|Rokudenashi→ロクデナシ|6|model',
      'artist|Vitaly Margulis, Frédéric Chopin→Vitaly Margulis|4|model',
      'album|THE BOOK ,→THE BOOK|8|model',
      'title|オリオン - Orion→オリオン|1|rule',
    ])
    expect(result.note).toBeNull()
    // The model is shown names, never titles.
    expect(llm.asked[0]!.prompt).not.toContain('オリオン')
  })

  it('still answers with the rules when the model can’t be reached, and says so', async () => {
    const llm = scriptedLlm({ 'tidy-names': [new LlmError('unreachable', 'down')] })
    const result = await tidy({ llm, songs: () => songs })
    expect(result.changes.every(change => change.by === 'rule')).toBe(true)
    expect(result.changes).toHaveLength(2)
    expect(result.note).toMatch(/couldn’t reach the model/)
  })

  it('shows the model each credit with more than one name once repeats are gone', () => {
    const prompt = namesPrompt(songs)
    expect(prompt).toContain('- Vitaly Margulis, Frédéric Chopin (1)')
    expect(prompt).not.toContain('薛之谦, 薛之谦')
    // Counted by the songs that name them, a repeat within one credit once.
    expect(prompt).toContain('- 薛之谦 (2)')
  })
})

describe('tidy, asked for something', () => {
  const many = Array.from({ length: 61 }, (_, index) =>
    song(index + 1, { title: `Track ${index + 1}`, album: 'OST' }),
  )
  const text = 'give these their Chinese names'

  it('asks in batches, and says which songs a failed batch left out', async () => {
    const llm = scriptedLlm({
      'tidy-asked': [
        { edits: [{ n: 1, field: 'title', to: '第一首', why: 'Official Chinese name' }], say: '' },
        new LlmError('busy', 'slow down'),
      ],
    })
    const result = await tidy({ llm, songs: () => [] }, undefined, {
      text,
      songs: many,
      unknown: [],
      lookUp: false,
    })
    expect(llm.asked).toHaveLength(2)
    expect(result.changes).toEqual([
      expect.objectContaining({ field: 'title', from: 'Track 1', to: '第一首', songIds: [1] }),
    ])
    expect(result).toMatchObject({ looked: 61, asked: text })
    expect(result.note).toMatch(/Left out 1 song;/)
  })

  it('fails as the model failed when no batch could be asked', async () => {
    const llm = scriptedLlm({ 'tidy-asked': [new LlmError('unreachable', 'down')] })
    await expect(
      tidy({ llm, songs: () => [] }, undefined, {
        text,
        songs: many.slice(0, 3),
        unknown: [],
        lookUp: false,
      }),
    ).rejects.toBeInstanceOf(LlmError)
  })

  it('changes no more songs than they said, taken from the ones that still need it', async () => {
    const llm = scriptedLlm({
      'tidy-sort': [{ n: [1, 3, 5] }],
      'tidy-asked': [
        { edits: [{ n: 2, field: 'title', to: '第三首', why: 'Official Chinese name' }], say: '' },
      ],
    })
    const result = await tidy({ llm, songs: () => [] }, undefined, {
      text: 'give the English ones their Chinese names, up to 2',
      songs: many,
      unknown: [],
      lookUp: false,
      limit: 2,
    })
    expect(llm.asked.map(each => each.task)).toEqual(['tidy-sort', 'tidy-asked'])
    expect(llm.asked[0]!.tier).toBe('fast')
    const table = llm.asked[1]!.prompt
    expect(table).toContain('1 | Track 1 |')
    expect(table).toContain('2 | Track 3 |')
    expect(table).not.toContain('Track 5')
    expect(result.changes).toEqual([
      expect.objectContaining({ from: 'Track 3', to: '第三首', songIds: [3] }),
    ])
    expect(result.looked).toBe(2)
    expect(result.note).toBe(
      'Changing the first 2 of the 3 songs that need it; ask again for the rest.',
    )
  })

  it('keeps every song of a batch it could not sort', async () => {
    const llm = scriptedLlm({
      'tidy-sort': [new LlmError('busy', 'slow down')],
      'tidy-asked': [{ edits: [], say: '' }],
    })
    const result = await tidy({ llm, songs: () => [] }, undefined, {
      text,
      songs: many.slice(0, 3),
      unknown: [],
      lookUp: false,
      limit: 2,
    })
    expect(llm.asked[1]!.prompt).toContain('2 | Track 2 |')
    expect(result.note).toMatch(/^Changing the first 2 of the 3 songs/)
  })

  it('says what the model told them when it changes nothing', async () => {
    const llm = scriptedLlm({
      'tidy-asked': [
        {
          edits: [],
          say: 'Track 1 looks like the song you mean, but I am not sure of its official name.',
        },
        {
          edits: [],
          say: 'Track 1 looks like the song you mean, but I am not sure of its official name.',
        },
      ],
    })
    const result = await tidy({ llm, songs: () => [] }, undefined, {
      text,
      songs: many,
      unknown: [],
      lookUp: false,
    })
    expect(result).toMatchObject({
      changes: [],
      reply: 'Track 1 looks like the song you mean, but I am not sure of its official name.',
    })
  })

  it('speaks from the batch that changed something, in the language they asked in', async () => {
    const llm = scriptedLlm({
      'tidy-asked': [
        {
          edits: [{ n: 1, field: 'title', to: '第一首', why: 'Chinese name' }],
          say: 'Renamed one.',
        },
        { edits: [], say: '这些歌里没有你说的那首。' },
      ],
    })
    const asked = { text, songs: many, unknown: [], lookUp: false }
    expect(await tidy({ llm, songs: () => [] }, undefined, asked)).toMatchObject({
      reply: 'Renamed one.',
    })
  })

  it('leaves the words to the card when more than one batch changed names', async () => {
    const llm = scriptedLlm({
      'tidy-asked': [
        { edits: [{ n: 1, field: 'title', to: '第一首', why: 'Chinese name' }], say: 'One.' },
        { edits: [{ n: 1, field: 'title', to: '第六十一首', why: 'Chinese name' }], say: 'Two.' },
      ],
    })
    const asked = { text, songs: many, unknown: [], lookUp: false }
    const result = await tidy({ llm, songs: () => [] }, undefined, asked)
    expect(result.changes).toHaveLength(2)
    expect(result.reply).toBeNull()
  })

  it('stops before the model when no song needs it', async () => {
    const llm = scriptedLlm({ 'tidy-sort': [{ n: [] }] })
    const result = await tidy({ llm, songs: () => [] }, undefined, {
      text,
      songs: many,
      unknown: [],
      lookUp: false,
      limit: 10,
    })
    expect(result).toMatchObject({ changes: [], looked: 61, note: null })
    expect(llm.asked.map(each => each.task)).toEqual(['tidy-sort'])
  })
})

describe('tidy, with names looked up', () => {
  const cliffs = song(1, {
    title: 'Wordless Cliffs',
    artist: 'HOYO-MiX',
    album: 'Millelith’s Watch',
  })
  const lost = song(2, { title: 'Not Anywhere', artist: 'HOYO-MiX' })
  const findNames = async (each: { id: number }) =>
    each.id === 1
      ? [
          {
            source: '网易云' as const,
            title: '丹砂巍巍 Wordless Cliffs',
            artist: 'HOYO-MiX',
            album: '原神-千岩旷望 Millelith’s Watch',
          },
        ]
      : []

  it('takes names only from what the catalogues have, and starts them ticked', async () => {
    const llm = scriptedLlm({
      'tidy-asked': [
        {
          edits: [
            { n: 1, field: 'title', to: '丹砂巍巍', why: 'Official Chinese name' },
            { n: 1, field: 'album', to: '千岩旷望', why: 'Official Chinese name' },
            // Words no catalogue has: made up, so dropped.
            { n: 1, field: 'artist', to: '米哈游', why: 'Official Chinese name' },
          ],
          say: '',
        },
      ],
    })
    const result = await tidy({ llm, songs: () => [], findNames }, undefined, {
      text: '加上官方的中文名，album也是',
      songs: [cliffs, lost],
      unknown: [],
      lookUp: true,
    })
    expect(
      result.changes.map(
        c => `${c.field}|${c.from}→${c.to}|${c.songIds.join(',')}|${c.by}|${c.why}`,
      ),
    ).toEqual([
      'album|Millelith’s Watch→千岩旷望|1|rule|The name on 网易云',
      'title|Wordless Cliffs→丹砂巍巍|1|rule|The name on 网易云',
    ])
    expect(result.note).toBe(
      '1 song wasn’t found on 网易云, MusicBrainz or iTunes, so it is left as it is.',
    )
    // Only the song that was found goes to the model, with what was found.
    const prompt = llm.asked[0]!.prompt
    expect(prompt).toContain(
      'found: 网易云 “丹砂巍巍 Wordless Cliffs” by HOYO-MiX on “原神-千岩旷望',
    )
    expect(prompt).not.toContain('Not Anywhere')
    expect(llm.asked[0]!.system).toContain('Never write a name that is not in what was found')
  })

  it('looks on the web for songs no catalogue has, and leaves those unticked', async () => {
    const llm = scriptedLlm({
      'tidy-web': [
        {
          edits: [{ n: 1, field: 'title', to: '无处可寻', why: 'Game wiki' }],
          say: 'Found on a game wiki.',
        },
      ],
    })
    const result = await tidy({ llm, songs: () => [], findNames, web: () => true }, undefined, {
      text: 'official Chinese names',
      songs: [lost],
      unknown: [],
      lookUp: true,
    })
    expect(result.changes).toEqual([
      expect.objectContaining({
        field: 'title',
        to: '无处可寻',
        by: 'model',
        why: 'Found on the web',
      }),
    ])
    expect(result.note).toMatch(/the web was searched instead/)
    // The names pass said nothing, so the web pass's words are the one thing said.
    expect(result.reply).toBe('Found on a game wiki.')
    expect(llm.asked.map(each => each.task)).toEqual(['tidy-web'])
    expect(llm.asked[0]!.webSearch).toBe(true)
  })

  it('looks up only the songs that still need it, when there are many', async () => {
    const many = Array.from({ length: 61 }, (_, index) =>
      song(index + 1, {
        title: index === 1 ? 'Wordless Cliffs' : `第${index + 1}首`,
        album: 'OST',
      }),
    )
    const looked: number[] = []
    const llm = scriptedLlm({ 'tidy-sort': [{ n: [2] }] })
    const result = await tidy(
      {
        llm,
        songs: () => [],
        findNames: async each => {
          looked.push(each.id)
          return []
        },
      },
      undefined,
      { text: '英文的换成官方中文名', songs: many, unknown: [], lookUp: true },
    )
    expect(looked).toEqual([2])
    expect(result.looked).toBe(61)
  })

  it('asks the model nothing when no song was found', async () => {
    const llm = scriptedLlm({})
    const result = await tidy({ llm, songs: () => [], findNames }, undefined, {
      text: 'official names',
      songs: [lost],
      unknown: [],
      lookUp: true,
    })
    expect(result.changes).toEqual([])
    expect(llm.asked).toHaveLength(0)
  })
})

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

describe('tidy, a checkup of some songs', () => {
  it('looks at those songs alone', async () => {
    const llm = scriptedLlm({ 'tidy-names': [{ spellings: [], credits: [], albums: [] }] })
    const mine = song(1, { title: 'Idol (Official Video)', artist: 'YOASOBI' })
    const other = song(2, { title: 'Lemon (Official Video)', artist: '米津玄師' })
    const result = await tidy({ llm, songs: () => [mine, other] }, undefined, null, [mine])
    expect(result.changes.map(each => each.songIds)).toEqual([[1]])
    expect(result.looked).toBe(1)
    expect(llm.asked[0]!.prompt).not.toContain('米津玄師')
  })
})
