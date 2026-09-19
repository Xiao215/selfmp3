import { describe, expect, it } from 'vitest'
import type { ParsedLyrics } from '@selfmp3/shared'

import {
  contextLine,
  parseMode,
  parseTab,
  parseView,
  resolveSongWords,
  romanName,
  stageGeometry,
  swipeOutcome,
  upNextSeconds,
  playSimilarOrder,
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
  instrumental: false,
  romanizationOn: false,
  romanized: null,
  offline: false,
}

describe('now playing', () => {
  it('reads the tab and mode from the address, defaulting to the lyrics stage', () => {
    expect(parseTab('about')).toBe('about')
    // Up next left the stage for the rail: an old address opens on the lyrics.
    expect(parseTab('queue')).toBe('lyrics')
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

  it('tells loading, offline and no lyrics apart', () => {
    expect(resolveSongWords({ ...base, loading: true })).toEqual({ status: 'loading' })
    expect(resolveSongWords({ ...base, offline: true })).toEqual({
      status: 'missing',
      offline: true,
    })
    expect(resolveSongWords(base)).toEqual({ status: 'missing', offline: false })
  })

  it('does not wait for the lookup to repeat what the library already knows', () => {
    // A song played before, whose lookup found nothing: it is on its visual
    // from the first frame rather than showing "Looking for lyrics…" and the
    // Lyrics button until the answer comes back a second time.
    expect(resolveSongWords({ ...base, instrumental: true, loading: true })).toEqual({
      status: 'missing',
      offline: false,
    })
    // Words found anyway — a sidecar added since — win over the stale flag.
    expect(resolveSongWords({ ...base, instrumental: true, parsed: SYNCED })).toMatchObject({
      status: 'lyrics',
    })
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

  it('steps the cover down for a song whose visual is the window', () => {
    const g = stageGeometry(1280, 732)
    expect(g.visualCover).toBeCloseTo(204.8)
    expect(g.visualCover).toBeLessThan(g.cover)
    expect(g.visualTitle).toBeGreaterThan(g.title)
    expect(stageGeometry(900, 400).visualCover).toBe(150)
  })

  it('stacks a page taller than wide, as an iPad in portrait (T05)', () => {
    const portrait = stageGeometry(834, 1110, 24)
    expect(portrait.stacked).toBe(true)
    expect(portrait.cover).toBeCloseTo(300.24)
    expect(portrait.inset).toBe(24)
    // Landscape, and a computer's window, keep the cover beside the words.
    expect(stageGeometry(1194, 750).stacked).toBe(false)
    expect(stageGeometry(1280, 816).stacked).toBe(false)
    // Width decides first: a tall window past 1000 is not stacked.
    expect(stageGeometry(1100, 1300).stacked).toBe(false)
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
})

describe('the phone page', () => {
  it('reads its view from the address, defaulting to the cover', () => {
    expect(parseView('lyrics')).toBe('lyrics')
    expect(parseView(undefined)).toBe('cover')
    expect(parseView('queue')).toBe('cover')
    expect(parseView(['lyrics'])).toBe('cover')
  })

  it('puts the page away on a long pull down from the cover, and opens the words on one up', () => {
    expect(swipeOutcome({ view: 'cover', dy: 200, vy: 0.2 })).toBe('close')
    expect(swipeOutcome({ view: 'cover', dy: -200, vy: -0.2 })).toBe('lyrics')
  })

  it('goes back to the cover from the words on a pull down, and ignores one up', () => {
    expect(swipeOutcome({ view: 'lyrics', dy: 200, vy: 0.2 })).toBe('cover')
    expect(swipeOutcome({ view: 'lyrics', dy: -200, vy: -2 })).toBeNull()
  })

  it('counts a short quick flick, and springs back from a short slow pull', () => {
    expect(swipeOutcome({ view: 'cover', dy: 60, vy: 1.2 })).toBe('close')
    expect(swipeOutcome({ view: 'cover', dy: -60, vy: -1.2 })).toBe('lyrics')
    expect(swipeOutcome({ view: 'cover', dy: 60, vy: 0.3 })).toBeNull()
    expect(swipeOutcome({ view: 'cover', dy: 30, vy: 3 })).toBeNull()
  })
})

describe('the similar-songs shelf', () => {
  it('plays the chosen song first, then the rest in their order', () => {
    expect(playSimilarOrder([4, 7, 9, 2], 9)).toEqual([9, 4, 7, 2])
    expect(playSimilarOrder([4, 7], 4)).toEqual([4, 7])
  })
})
