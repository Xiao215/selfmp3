import { describe, expect, it } from 'vitest'
import type { ParsedLyrics } from '@selfmp3/shared'

import {
  contextLine,
  hexAlpha,
  parseMode,
  parseTab,
  resolveSongWords,
  romanName,
  stageGeometry,
  upNextSeconds,
  autoMixLine,
} from './nowPlaying.model'

const SYNCED: ParsedLyrics = {
  synced: true,
  lines: [
    { time: 1, text: '無敵の笑顔' },
    { time: 4, text: '知りたい' },
  ],
} as ParsedLyrics

const base = {
  loading: false,
  parsed: null,
  romanizationOn: false,
  romanized: null,
  offline: false,
  instrumental: false,
}

describe('now playing', () => {
  it('reads the tab and mode from the address, defaulting to the lyrics stage', () => {
    expect(parseTab('queue')).toBe('queue')
    expect(parseTab('about')).toBe('about')
    expect(parseTab(undefined)).toBe('lyrics')
    expect(parseTab('nonsense')).toBe('lyrics')
    expect(parseMode('focus')).toBe('focus')
    expect(parseMode(['focus'])).toBe('stage')
  })

  it('shows lyrics, with romanization only when it lines up', () => {
    const lined = resolveSongWords({
      ...base,
      parsed: SYNCED,
      romanizationOn: true,
      romanized: ['muteki no egao', 'shiri tai'],
    })
    expect(lined).toMatchObject({ status: 'lyrics', roman: ['muteki no egao', 'shiri tai'] })
    const misaligned = resolveSongWords({
      ...base,
      parsed: SYNCED,
      romanizationOn: true,
      romanized: ['muteki no egao'],
    })
    expect(misaligned).toMatchObject({ status: 'lyrics', roman: null })
    const off = resolveSongWords({ ...base, parsed: SYNCED, romanized: ['a', 'b'] })
    expect(off).toMatchObject({ status: 'lyrics', roman: null })
  })

  it('tells loading, offline, instrumental and missing apart', () => {
    expect(resolveSongWords({ ...base, loading: true })).toEqual({ status: 'loading' })
    expect(resolveSongWords({ ...base, offline: true, instrumental: true })).toEqual({
      status: 'missing',
      offline: true,
    })
    expect(resolveSongWords({ ...base, instrumental: true })).toEqual({ status: 'instrumental' })
    expect(resolveSongWords(base)).toEqual({ status: 'missing', offline: false })
  })

  it('names the romanization for the language', () => {
    expect(romanName('ja')).toBe('Romaji')
    expect(romanName('zh')).toBe('Pinyin')
  })

  it('lays the page out as the web does at 1280 by 816', () => {
    const g = stageGeometry(1280, 816)
    expect(g.cover).toBe(400)
    expect(g.pad).toBe(64)
    expect(g.pad + g.cover + g.gutter).toBe(528)
    expect(g.right).toBeCloseTo(51.2)
    expect(g.lyric).toBeCloseTo(29.44)
  })

  it('shrinks the cover on a short page, but never below 180', () => {
    expect(stageGeometry(1280, 600).cover).toBe(310)
    expect(stageGeometry(900, 300).cover).toBe(180)
  })

  it('says where in the queue it is', () => {
    expect(contextLine(false, 9, 13)).toBe('Playing · 10 of 13')
    expect(contextLine(true, 0, 2)).toBe('Shuffling · 1 of 2')
  })

  it('shows "Next" for the last fifteen seconds only', () => {
    const song = { hasNext: true, repeatOne: false, duration: 200 }
    expect(upNextSeconds({ ...song, position: 180 })).toBeNull()
    expect(upNextSeconds({ ...song, position: 188.2 })).toBe(12)
    expect(upNextSeconds({ ...song, position: 200 })).toBeNull()
    expect(upNextSeconds({ ...song, repeatOne: true, position: 190 })).toBeNull()
    expect(upNextSeconds({ ...song, hasNext: false, position: 190 })).toBeNull()
    expect(upNextSeconds({ ...song, duration: 25, position: 20 })).toBeNull()
  })

  it('writes a token at an opacity', () => {
    expect(hexAlpha('#0b0d13', 0.5)).toBe('rgba(11, 13, 19, 0.5)')
  })
})

describe('autoMixLine', () => {
  const on = { autoMix: true, canCrossfade: true, upcoming: 3, nextCrossfadeSeconds: 4 }
  it('says the queue plays in order when it is off', () => {
    expect(autoMixLine({ ...on, autoMix: false })).toBe('plays in queue order')
  })
  it('names the next crossfade where the player can fade', () => {
    expect(autoMixLine(on)).toBe('next crossfade 4s')
  })
  it('says only the order where it cannot, and when nothing follows', () => {
    expect(autoMixLine({ ...on, canCrossfade: false })).toBe('ordered by tempo, key and energy')
    expect(autoMixLine({ ...on, upcoming: 0 })).toBe('nothing to mix yet')
  })
})
