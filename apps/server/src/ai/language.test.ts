import { describe, expect, it } from 'vitest'
import { languageName, languageOf, localeLanguage, withoutNames } from './language.js'

describe('the language of a request', () => {
  it('tells languages in Latin letters apart', () => {
    expect(languageOf('remove the yoasobi concert playlist and all their concert songs')).toBe('en')
    expect(languageOf('what is the story behind this album')).toBe('en')
    expect(languageOf('mets de la musique douce pour lire')).toBe('fr')
    expect(languageOf('spiel bitte etwas ruhiges für mich')).toBe('de')
  })

  it('tells Chinese, Japanese and Korean apart by their characters', () => {
    expect(languageOf('放一些安静的歌')).toBe('zh')
    expect(languageOf('静かな曲をかけて')).toBe('ja')
    expect(languageOf('조용한 노래 틀어줘')).toBe('ko')
    // Chinese around a Japanese title is Chinese.
    expect(languageOf('播放夜に駆ける的现场版')).toBe('zh')
  })

  it('reads a sentence in Latin letters around a name in another script as that sentence', () => {
    expect(languageOf('play 群青 by YOASOBI and the rest of that album')).toBe('en')
  })

  it('says nothing when it cannot tell', () => {
    // A few words in Latin letters are too few: the identifier is sure, and wrong.
    expect(languageOf('shuffle my queue')).toBeNull()
    expect(languageOf('calm piano')).toBeNull()
    expect(languageOf('skip')).toBeNull()
    expect(languageOf('42')).toBeNull()
    expect(languageOf('')).toBeNull()
  })
})

describe('names taken out', () => {
  it('takes out the names a text holds, so their language does not count', () => {
    const names = ['群青', 'YOASOBI', '夜に駆ける', 'Rain']
    expect(languageOf(withoutNames('删除YOASOBI演唱会的歌单', names))).toBe('zh')
    expect(languageOf(withoutNames('play 夜に駆ける for me now please', names))).toBe('en')
  })

  it('takes a name in Latin letters only as whole words', () => {
    expect(withoutNames('a rainy day', ['Rain'])).toBe('a rainy day')
    expect(withoutNames('play Rain now', ['Rain'])).toBe('play   now')
  })

  it('leaves short names, which are words as often as names', () => {
    expect(withoutNames('play it up', ['Up', 'It'])).toBe('play it up')
  })
})

describe('naming a language', () => {
  it('names it in English for the model', () => {
    expect(languageName('en')).toBe('English')
    expect(languageName('ja')).toBe('Japanese')
  })

  it('reads a device locale', () => {
    expect(localeLanguage('zh-Hans-CN')).toBe('zh')
    expect(localeLanguage('en_CA')).toBe('en')
    expect(localeLanguage(null)).toBeNull()
  })
})
