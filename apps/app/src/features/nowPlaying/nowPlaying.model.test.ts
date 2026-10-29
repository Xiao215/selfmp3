import { describe, expect, it } from 'vitest'
import type { ParsedLyrics } from '@selfmp3/shared'

import {
  backdropVeil,
  contextLine,
  parseMode,
  parseTab,
  parseView,
  resolveSongWords,
  romanName,
  stageGeometry,
  swipeOutcome,
  upNextSeconds,
  type PhoneView,
} from './nowPlaying.model'
import { PULL } from '../../ui/motion.model'

const SYNCED: ParsedLyrics = {
  synced: true,
  lines: [
    { time: 1, text: '無敵の笑顔' },
    { time: 4, text: '知りたい' },
  ],
} as ParsedLyrics

/**
 * A pull let go of, with the thresholds the screen hands in: `PULL` in
 * `ui/motion.model.ts`, which the model cannot read for itself.
 */
const letGo = (pull: { view: PhoneView; dy: number; vy: number }) =>
  swipeOutcome({ ...pull, close: PULL.close, flick: PULL.flick })

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
    const geometry = stageGeometry(1280, 816)
    expect(geometry.cover).toBe(400)
    expect(geometry.pad).toBe(64)
    expect(geometry.pad + geometry.cover + geometry.gutter).toBe(528)
    expect(geometry.right).toBeCloseTo(51.2)
    expect(geometry.lyric).toBeCloseTo(29.44)
  })

  it('grows the cover, the title and the words on a very wide page, and only there', () => {
    expect(stageGeometry(1800, 1000)).toMatchObject({
      column: 400,
      cover: 400,
      title: 30,
      lyric: 32,
    })
    const wide = stageGeometry(2800, 1116)
    expect(wide.cover).toBe(560)
    expect(wide.title).toBe(43.75)
    expect(wide.lyric).toBeCloseTo(37.8)
    // A short window still keeps the cover clear of the bar.
    expect(stageGeometry(2800, 700).cover).toBe(410)
    expect(stageGeometry(3600, 1400)).toMatchObject({ cover: 700, title: 50, lyric: 44 })
  })

  it('gives the song a third of a 2560 window, its cover half the height (AJ1)', () => {
    const screen = stageGeometry(2560, 1212)
    expect(screen.column).toBeCloseTo(2560 / 3 - 72)
    expect(screen.cover).toBe(606)
    expect(screen.title).toBe(40)
    // Halfway there at 2100.
    const between = stageGeometry(2100, 1100)
    expect(between.cover).toBeGreaterThan(420)
    expect(between.cover).toBeLessThan(550)
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

  it('says where in the queue it is, and nothing for a song alone', () => {
    expect(contextLine(9, 13)).toBe('10 of 13')
    expect(contextLine(0, 2)).toBe('1 of 2')
    expect(contextLine(0, 1)).toBeNull()
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
    expect(letGo({ view: 'cover', dy: 200, vy: 0.2 })).toBe('close')
    expect(letGo({ view: 'cover', dy: -200, vy: -0.2 })).toBe('lyrics')
  })

  it('goes back to the cover from the words on a pull down, and ignores one up', () => {
    expect(letGo({ view: 'lyrics', dy: 200, vy: 0.2 })).toBe('cover')
    expect(letGo({ view: 'lyrics', dy: -200, vy: -2 })).toBeNull()
  })

  it('counts a short quick flick, and springs back from a short slow pull', () => {
    expect(letGo({ view: 'cover', dy: 60, vy: 1.2 })).toBe('close')
    expect(letGo({ view: 'cover', dy: -60, vy: -1.2 })).toBe('lyrics')
    expect(letGo({ view: 'cover', dy: 60, vy: 0.3 })).toBeNull()
    expect(letGo({ view: 'cover', dy: 30, vy: 3 })).toBeNull()
  })
})

describe("the veil over the phone page's cover", () => {
  const tone = (l: number) => ({ hue: 0, chroma: 0, palette: [{ l, c: 0, h: 0, share: 1 }] })

  it("leaves a cover far from the text at the page's own veil", () => {
    expect(backdropVeil(tone(0.2), 'dark', 0.56)).toBe(0.56)
    expect(backdropVeil(tone(0.9), 'light', 0.56)).toBe(0.56)
    expect(backdropVeil(null, 'dark', 0.56)).toBe(0.56)
  })

  it('thickens it as the cover nears the text, a white cover under the dark theme most', () => {
    expect(backdropVeil(tone(0.95), 'dark', 0.56)).toBeCloseTo(0.86)
    expect(backdropVeil(tone(0.05), 'light', 0.56)).toBeCloseTo(0.86)
    const middling = backdropVeil(tone(0.7), 'dark', 0.56)
    expect(middling).toBeGreaterThan(0.56)
    expect(middling).toBeLessThan(0.86)
  })
})
