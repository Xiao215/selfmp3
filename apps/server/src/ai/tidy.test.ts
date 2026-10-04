import { describe, expect, it } from 'vitest'
import { scriptedLlm, song } from './fixtures/library.js'
import { LlmError } from './llm.js'
import { withoutRepeats, withoutTranslation, withoutUseNote } from '@selfmp3/shared'
import {
  couldBeOneName,
  namesPrompt,
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
    expect(prompt).toContain('- 薛之谦 (6)')
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
        { edits: [{ n: 1, field: 'title', to: '第一首', why: 'Official Chinese name' }] },
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

  it('looks on the web for songs no catalogue has, when Settings allows, and leaves those unticked', async () => {
    const llm = scriptedLlm({
      'tidy-web': [{ edits: [{ n: 1, field: 'title', to: '无处可寻', why: 'Game wiki' }] }],
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
    expect(llm.asked.map(each => each.task)).toEqual(['tidy-web'])
    expect(llm.asked[0]!.webSearch).toBe(true)
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
