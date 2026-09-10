import { describe, expect, it } from 'vitest'
import { detectLyricsLanguage, detectScript, isCjkQuery, planRomanization } from './script.js'

describe('detectScript', () => {
  it('classifies Han-only text', () => {
    expect(detectScript('夜空慢慢暗下来')).toBe('han')
  })

  it('classifies kana-only text', () => {
    expect(detectScript('さよならは')).toBe('kana')
    expect(detectScript('サヨナラ')).toBe('kana')
  })

  it('classifies kanji plus kana as mixed', () => {
    expect(detectScript('桜の風が吹くとき')).toBe('mixed')
  })

  it('classifies Latin text and punctuation-only text', () => {
    expect(detectScript('hello world')).toBe('latin')
    expect(detectScript('♪ ... 123')).toBe('none')
    expect(detectScript('')).toBe('none')
  })
})

describe('detectLyricsLanguage', () => {
  it('is Chinese when there is Han but no kana anywhere', () => {
    expect(detectLyricsLanguage(['夜空慢慢暗下来', '星星一颗颗亮起来', 'oh yeah'])).toBe('zh')
  })

  it('is Japanese as soon as a single line has kana, even if most lines are kanji only', () => {
    expect(detectLyricsLanguage(['桜', '風', '記憶の道'])).toBe('ja')
  })

  it('is none for Latin-only lyrics', () => {
    expect(detectLyricsLanguage(['just a song', 'la la la'])).toBe('none')
    expect(detectLyricsLanguage([])).toBe('none')
  })
})

describe('planRomanization', () => {
  it('sends every non-Latin line of a Japanese song through romaji, kanji-only ones included', () => {
    const lines = ['桜の風', '記憶', 'English chorus', '', 'サヨナラ']
    expect(planRomanization(lines, 'ja')).toEqual(['romaji', 'romaji', 'none', 'none', 'romaji'])
  })

  it('sends Han lines of a Chinese song through pinyin', () => {
    const lines = ['夜空', 'oh oh', '晚安 夜空']
    expect(planRomanization(lines, 'zh')).toEqual(['pinyin', 'none', 'pinyin'])
  })

  it('keeps the output aligned with the input, one entry per line', () => {
    const lines = ['a', '夜', '', 'b', '空']
    expect(planRomanization(lines, 'zh')).toHaveLength(lines.length)
    expect(planRomanization(lines, 'none')).toEqual(['none', 'none', 'none', 'none', 'none'])
  })
})

describe('isCjkQuery', () => {
  it('spots CJK in a short query', () => {
    expect(isCjkQuery('夜空')).toBe(true)
    expect(isCjkQuery('さくら')).toBe(true)
    expect(isCjkQuery('sky')).toBe(false)
  })
})
