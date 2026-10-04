import { describe, expect, it } from 'vitest'
import { scriptedLlm, song } from './fixtures/library.js'
import { LlmError } from './llm.js'
import { withoutRepeats, withoutTranslation } from '@selfmp3/shared'
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
