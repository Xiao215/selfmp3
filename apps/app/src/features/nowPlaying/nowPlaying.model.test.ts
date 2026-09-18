import { describe, expect, it } from 'vitest'
import type { ParsedLyrics } from '@selfmp3/shared'

import {
  contextLine,
  parseMode,
  parseTab,
  resolveSongWords,
  romanName,
  stageGeometry,
  upNextSeconds,
  autoMixLine,
  PHONE_ART_MIN,
  playSimilarOrder,
  queueLines,
  similarShelfLayout,
  upNextLine,
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

describe('the similar-songs shelf on a phone', () => {
  it('fits on a tall phone, and the cover gives up its height', () => {
    // iPhone 17 Pro Max: 440 wide, 956 tall.
    expect(similarShelfLayout({ width: 440, height: 956, sidePadding: 16, similar: 10 })).toEqual({
      artSize: 312,
      showShelf: true,
    })
  })

  it('keeps the shelf’s place while this song’s neighbours are unknown', () => {
    // The song changed a moment ago and the answer is still out: laying the
    // page out for "none" here is what made the cover jump to full width for a
    // frame and back.
    expect(similarShelfLayout({ width: 393, height: 852, sidePadding: 16, similar: null })).toEqual(
      similarShelfLayout({ width: 393, height: 852, sidePadding: 16, similar: 4 }),
    )
  })

  it('stays out when the cover would go below its floor, and the page is as it was', () => {
    // A 667-point phone: 667 − 500 is already under the floor.
    expect(similarShelfLayout({ width: 375, height: 667, sidePadding: 16, similar: 10 })).toEqual({
      artSize: PHONE_ART_MIN,
      showShelf: false,
    })
  })

  it('stays out when there is nothing similar', () => {
    expect(similarShelfLayout({ width: 440, height: 956, sidePadding: 16, similar: 0 })).toEqual({
      artSize: 340,
      showShelf: false,
    })
  })

  it('plays the chosen song first, then the rest in their order', () => {
    expect(playSimilarOrder([4, 7, 9, 2], 9)).toEqual([9, 4, 7, 2])
    expect(playSimilarOrder([4, 7], 4)).toEqual([4, 7])
  })
})

describe('the queue from what is playing', () => {
  it('folds the played songs into one line above the song that is playing', () => {
    expect(queueLines(2, 4, false)).toEqual([
      { kind: 'played', count: 2, open: false },
      { kind: 'song', index: 2 },
      { kind: 'upNext' },
      { kind: 'song', index: 3 },
    ])
  })

  it('puts the played songs back when the fold is open', () => {
    expect(queueLines(2, 3, true)).toEqual([
      { kind: 'played', count: 2, open: true },
      { kind: 'song', index: 0 },
      { kind: 'song', index: 1 },
      { kind: 'song', index: 2 },
    ])
  })

  it('has no fold at the first song and no label at the last', () => {
    expect(queueLines(0, 2, false)).toEqual([
      { kind: 'song', index: 0 },
      { kind: 'upNext' },
      { kind: 'song', index: 1 },
    ])
    expect(queueLines(0, 1, true)).toEqual([{ kind: 'song', index: 0 }])
    expect(queueLines(0, 0, false)).toEqual([])
  })

  it('counts what follows in the label', () => {
    expect(upNextLine(1, 250)).toBe('Up next · 1 song · 4 min')
    expect(upNextLine(12, 3900)).toBe('Up next · 12 songs · 1 hr 5 min')
  })
})
