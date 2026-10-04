import { describe, expect, it } from 'vitest'
import type { Stats } from '@selfmp3/shared'
import { ask, foundFor, matchPlaylist } from './ask.js'
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
  minutes: null,
  brief: null,
}

const route = (overrides: Record<string, unknown>) => ({
  action: 'none',
  play: false,
  next: false,
  songs: null,
  find: null,
  stats: null,
  playlists: null,
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
    playlists: () => PLAYLISTS,
  }
}

const PLAYLISTS = [{ name: 'chill · chinese · hype' }, { name: 'chill · chinese' }, { name: 'hi' }]

describe('matchPlaylist', () => {
  it('finds a playlist however it is spaced, dotted or cased', () => {
    expect(matchPlaylist('Chill Chinese Hype', PLAYLISTS)).toBe('chill · chinese · hype')
    expect(matchPlaylist('chill chinese', PLAYLISTS)).toBe('chill · chinese')
  })

  it('forgives a slip or two, and names nothing that is not there', () => {
    expect(matchPlaylist('chill chiense hype', PLAYLISTS)).toBe('chill · chinese · hype')
    expect(matchPlaylist('chill chiense', PLAYLISTS)).toBe('chill · chinese')
    expect(matchPlaylist('workout', PLAYLISTS)).toBeNull()
    expect(matchPlaylist('', PLAYLISTS)).toBeNull()
  })
})

describe('ask, about playlists', () => {
  it('proposes deleting the playlists meant, by their real names', async () => {
    const d = deps({
      'ask-route': [
        route({
          action: 'playlists',
          playlists: {
            op: 'delete',
            names: ['chill chiense hype', 'chill chiense', 'gym'],
            newName: null,
          },
        }),
      ],
    })
    expect(await ask(d, 'remove the chill chiense hype and chill chiense playlists')).toEqual({
      kind: 'playlists',
      op: 'delete',
      names: ['chill · chinese · hype', 'chill · chinese'],
      newName: null,
      unknown: ['gym'],
    })
  })

  it('renames one playlist, and asks again when it cannot tell which or to what', async () => {
    const rename = (names: string[], newName: string | null) =>
      deps({
        'ask-route': [route({ action: 'playlists', playlists: { op: 'rename', names, newName } })],
      })
    expect(await ask(rename(['hi'], ' 华语慢歌 '), 'rename hi')).toMatchObject({
      kind: 'playlists',
      op: 'rename',
      names: ['hi'],
      newName: '华语慢歌',
    })
    expect(await ask(rename(['hi'], null), 'rename hi')).toMatchObject({ kind: 'none' })
    expect(await ask(rename(['nothing'], 'x'), 'rename nothing')).toEqual({
      kind: 'none',
      say: 'No playlist here is called “nothing”.',
    })
  })

  it('shows the model the playlists it may name', async () => {
    const d = deps({ 'ask-route': [route({ action: 'none', say: 'x' })] })
    await ask(d, 'delete hi')
    expect(String(d.llm.asked[0]?.prompt)).toContain(
      'chill · chinese · hype | chill · chinese | hi',
    )
  })
})

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

  it('steers from the song playing: shown as "this", left out of the picks, led as next', async () => {
    const d = deps({
      'ask-route': [
        route({ action: 'songs', next: true, songs: { ...noFilters, artists: ['YOASOBI'] } }),
      ],
    })
    const answer = await ask(d, 'more like this after', 7)
    expect(answer).toMatchObject({ kind: 'songs', lead: 'next' })
    expect(answer.kind === 'songs' && answer.describe.picks.map(pick => pick.songId)).toEqual([8])
    const playing = SONGS.find(song => song.id === 7)!
    expect(d.llm.asked[0]!.prompt).toContain(`Now playing: ${playing.title} | ${playing.artist}`)
  })

  it('does not lead with next when nothing is playing', async () => {
    const d = deps({
      'ask-route': [
        route({ action: 'songs', next: true, songs: { ...noFilters, artists: ['YOASOBI'] } }),
      ],
    })
    expect(await ask(d, 'queue some YOASOBI')).toMatchObject({ kind: 'songs', lead: 'save' })
  })

  it('hands anything about tags to the tag review, with the request itself', async () => {
    const d = deps({
      'ask-route': [route({ action: 'tags' })],
      'tags-plan': [
        {
          checkup: false,
          ops: [],
          focus: ['jpop'],
          newTag: null,
          songs: 'without',
          artists: ['Yorushika'],
        },
      ],
      'tags-groups': [
        {
          groups: [
            { g: 'g1', add: ['jpop'], remove: [], newTag: null, sure: 'high', why: 'J-pop' },
          ],
        },
      ],
    })
    const answer = await ask(d, 'tag the yorushika songs that should be jpop')
    expect(answer).toMatchObject({ kind: 'tags', review: { asked: expect.any(String) } })
    if (answer.kind !== 'tags') throw new Error('not tags')
    expect(answer.review.changes).toEqual([
      expect.objectContaining({ op: 'add', tag: 'jpop', songIds: [13] }),
    ])
    expect(d.llm.asked[1]!.prompt).toContain('tag the yorushika songs that should be jpop')
  })

  it('says so when Tags is turned off', async () => {
    const d = deps({ 'ask-route': [route({ action: 'tags' })] })
    expect(await ask(d, 'tidy my tags', null, { tidy: true, tags: false })).toMatchObject({
      kind: 'none',
    })
    expect(d.llm.asked).toHaveLength(1)
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
