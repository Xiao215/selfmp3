import { describe, expect, it } from 'vitest'
import type { Stats } from '@selfmp3/shared'
import { ask, foundFor } from './ask.js'
import { SONGS, TAGS, scriptedLlm } from './fixtures/library.js'

const NOW = Date.parse('2026-10-03T12:00:00Z')

const noFilters = {
  name: 'x',
  anyTags: [],
  artists: [],
  noTags: [],
  energy: { min: null, max: null },
  bpm: { min: null, max: null },
  words: null,
  loved: null,
  playedWithinDays: null,
  notPlayedWithinDays: null,
  addedWithinDays: null,
  size: null,
  brief: null,
}

const route = (overrides: Record<string, unknown>) => ({
  action: 'none',
  play: false,
  songs: null,
  tag: null,
  find: null,
  stats: null,
  open: null,
  say: null,
  ...overrides,
})

const STATS: Stats = {
  range: '30d',
  totals: {
    plays: 50,
    minutes: 48,
    songsPlayed: 49,
    librarySize: 17,
    libraryMinutes: 56,
    neverPlayed: 3,
  },
  streakDays: 1,
  longestStreakDays: 2,
  daily: [],
  hourly: [],
  topArtists: [{ key: 'HOYO-MiX', plays: 23, minutes: 20 }],
  topTags: [{ key: 'jpop', plays: 24, minutes: 25 }],
  topSongs: [
    { songId: 6, title: 'Light Glimmers', artist: 'HOYO-MiX', hasArt: true, plays: 2, minutes: 4 },
  ],
}

function deps(replies: Record<string, unknown[]>) {
  const llm = scriptedLlm(replies)
  return {
    llm,
    songs: () => SONGS,
    tags: () => TAGS,
    now: () => NOW,
    stats: () => STATS,
    lyrics: (query: string) => (query === '外婆' ? [{ songId: 15, line: '外婆的家' }] : []),
  }
}

describe('ask', () => {
  it('turns a request for music into Describe’s answer, with what it led with', async () => {
    const d = deps({
      'ask-route': [
        route({ action: 'songs', play: true, songs: { ...noFilters, artists: ['YOASOBI'] } }),
      ],
    })
    const answer = await ask(d, 'play some YOASOBI')
    expect(answer).toMatchObject({ kind: 'songs', lead: 'play' })
    expect(answer.kind === 'songs' && answer.describe.picks.map(pick => pick.songId)).toEqual([
      7, 8,
    ])
    // The route is the plan: nothing else was asked.
    expect(d.llm.asked.map(each => each.task)).toEqual(['ask-route'])
  })

  it('proposes a tag for the songs the filters choose, counting the ones that have it', async () => {
    const d = deps({
      'ask-route': [
        route({
          action: 'tag',
          tag: { name: 'JPOP' },
          songs: { ...noFilters, artists: ['Yorushika'] },
        }),
      ],
    })
    expect(await ask(d, 'tag yorushika jpop')).toMatchObject({
      kind: 'tag',
      tag: 'jpop',
      isNew: false,
      songIds: [13],
      already: 1,
    })
  })

  it('will not tag the whole library', async () => {
    const d = deps({
      'ask-route': [route({ action: 'tag', tag: { name: 'mine' }, songs: noFilters })],
    })
    expect(await ask(d, 'tag everything mine')).toMatchObject({ kind: 'none' })
  })

  it('finds a half-remembered song through titles and lyrics, then picks', async () => {
    const d = deps({
      'ask-route': [
        route({ action: 'find', find: { terms: ['外婆', 'tea'], brief: 'grandma’s tea' } }),
      ],
      'ask-find': [
        {
          picks: [
            { n: 1, why: 'about a grandmother' },
            { n: 9, why: 'made up' },
          ],
        },
      ],
    })
    const answer = await ask(d, 'the song about grandma’s tea')
    expect(answer).toEqual({
      kind: 'find',
      terms: ['外婆', 'tea'],
      picks: [{ songId: 15, why: 'about a grandmother' }],
    })
    expect(d.llm.asked[1]!.prompt).toContain('lyric: 外婆的家')
  })

  it('answers a listening question from the plays, not from the model', async () => {
    const d = deps({
      'ask-route': [route({ action: 'stats', stats: { range: '30d', about: 'songs' } })],
    })
    expect(await ask(d, 'what did I play most')).toEqual({
      kind: 'stats',
      range: '30d',
      about: 'songs',
      plays: 50,
      minutes: 48,
      items: [{ label: 'Light Glimmers · HOYO-MiX', plays: 2, songId: 6 }],
    })
  })

  it('sends somewhere else, or says what it can do', async () => {
    const open = deps({
      'ask-route': [route({ action: 'open', open: 'import', say: 'Import takes a link.' })],
    })
    expect(await ask(open, 'download an album')).toEqual({
      kind: 'open',
      place: 'import',
      say: 'Import takes a link.',
    })

    // An action without what it needs is not trusted.
    const broken = deps({ 'ask-route': [route({ action: 'songs', songs: null })] })
    expect((await ask(broken, 'hm')).kind).toBe('none')
  })
})

describe('foundFor', () => {
  it('matches titles, artists and albums, then lyrics, once each', () => {
    const lyrics = (query: string) => (query === 'yoasobi' ? [{ songId: 7, line: 'a line' }] : [])
    const found = foundFor(['YOASOBI'], SONGS, lyrics)
    expect(found.map(each => [each.song.id, each.line])).toEqual([
      [7, 'a line'],
      [8, null],
    ])
  })
})
