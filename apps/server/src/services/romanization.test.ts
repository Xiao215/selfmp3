import { describe, expect, it } from 'vitest'
import { createLogger } from '../logger.js'
import { exportedClass, RomanizationService, toLyricLines } from './romanization.js'

/**
 * Alignment is what matters here: every output line must sit under exactly
 * one input line with the same timestamp. The engines are faked, because the
 * real ones are tested by hand against the sample library and loading the
 * Japanese dictionary in a unit test would be slow for no extra confidence.
 */

const fakeEngines = {
  pinyin: (text: string) => `PY(${text})`,
  romaji: (text: string) => Promise.resolve(`RJ(${text})`),
}

const service = () => new RomanizationService(createLogger('silent'), fakeEngines)

describe('toLyricLines', () => {
  it('keeps timestamps for synced text and nulls them for plain text', () => {
    expect(toLyricLines('[00:01.00]a\n[00:02.50]b')).toEqual({
      synced: true,
      lines: [
        { time: 1, text: 'a' },
        { time: 2.5, text: 'b' },
      ],
    })
    expect(toLyricLines('a\nb')).toEqual({
      synced: false,
      lines: [
        { time: null, text: 'a' },
        { time: null, text: 'b' },
      ],
    })
  })
})

describe('RomanizationService.romanize', () => {
  it('routes a Chinese song through pinyin, line by line, keeping timestamps', async () => {
    const { lyrics: result } = await service().romanize(
      '[ti:夜空]\n[00:01.00]夜空慢慢暗下来\n[00:05.00]oh yeah\n[00:09.00]晚安 夜空',
    )
    expect(result.language).toBe('zh')
    expect(result.synced).toBe(true)
    expect(result.lines).toEqual([
      { time: 1, text: '夜空慢慢暗下来', romanized: 'PY(夜空慢慢暗下来)' },
      { time: 5, text: 'oh yeah', romanized: '' },
      { time: 9, text: '晚安 夜空', romanized: 'PY(晚安 夜空)' },
    ])
  })

  it('routes a Japanese song through romaji — kanji-only lines included, never pinyin', async () => {
    const { lyrics: result } = await service().romanize(
      '桜の風が吹くとき\n遠い記憶\n\nEnglish line',
    )
    expect(result.language).toBe('ja')
    expect(result.synced).toBe(false)
    expect(result.lines.map(line => line.romanized)).toEqual([
      'RJ(桜の風が吹くとき)',
      'RJ(遠い記憶)',
      '',
      '',
    ])
    expect(result.lines.map(line => line.text)).toEqual([
      '桜の風が吹くとき',
      '遠い記憶',
      '',
      'English line',
    ])
  })

  it('leaves a Latin song alone with the same number of lines', async () => {
    const { lyrics: result } = await service().romanize('just words\nmore words')
    expect(result.language).toBe('none')
    expect(result.lines).toHaveLength(2)
    expect(result.lines.every(line => line.romanized === '')).toBe(true)
  })
})

describe('RomanizationService completeness', () => {
  it('is complete when every engine a line needed was there', async () => {
    expect((await service().romanize('桜の風が吹くとき')).complete).toBe(true)
    expect((await service().romanize('just words')).complete).toBe(true)
  })
})

describe('exportedClass', () => {
  class Engine {}

  it('takes the class from how plain Node loads a Babel-built package', () => {
    expect(exportedClass({ default: { default: Engine } })).toBe(Engine)
  })

  it('takes the class from how tsx loads the same package', () => {
    expect(exportedClass({ default: Engine })).toBe(Engine)
  })
})
