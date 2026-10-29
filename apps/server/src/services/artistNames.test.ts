import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { formatHlc, type Song } from '@selfmp3/shared'
import { migrate } from '../db/migrate.js'
import { createLogger } from '../logger.js'
import { NamesRepository } from '../repositories/names.js'
import { ArtistNameLookup } from './artistNames.js'
import { RateLimiter } from './rateLimiter.js'

/**
 * MusicBrainz is the one thing faked: its answers are cut down from what it
 * really said for these artists (2026-10-24) — 周杰伦 an alias of 周杰倫, 幾田りら
 * the person behind "ikura", and three different artists called ikura.
 */

const answers: Record<string, unknown> = {
  'search 周杰伦': {
    artists: [
      {
        id: 'jay',
        name: '周杰倫',
        'sort-name': 'Chou, Jay',
        aliases: [{ name: '周杰伦' }, { name: 'Jay Chou' }],
      },
      { id: 'zhou-jie', name: '周杰', 'sort-name': 'Zhou, Jie', aliases: [{ name: 'Zhou Jie' }] },
    ],
  },
  'read jay': {
    id: 'jay',
    name: '周杰倫',
    'sort-name': 'Chou, Jay',
    aliases: [
      { name: '周杰伦' },
      { name: 'Jay Chou' },
      { name: '주걸륜' },
      { name: 'ジェイ・チョウ' },
    ],
    relations: [],
  },
  'search 幾田りら': {
    artists: [{ id: 'lilas', name: '幾田りら', 'sort-name': 'Ikuta, Lilas', aliases: [] }],
  },
  'read lilas': {
    id: 'lilas',
    name: '幾田りら',
    'sort-name': 'Ikuta, Lilas',
    aliases: [{ name: 'Lilas Ikuta' }],
    relations: [
      { type: 'is person', artist: { name: 'ikura' } },
      { type: 'member of band', artist: { name: 'YOASOBI' } },
    ],
  },
  'search ikura': {
    artists: [
      { id: 'ikura-1', name: 'ikura', aliases: [] },
      { id: 'ikura-2', name: 'Ikura', aliases: [] },
    ],
  },
}

const song = (id: number, artist: string) =>
  ({ id, title: `Song ${id}`, artist, album: '' }) as Song

describe('ArtistNameLookup', () => {
  let db: Database.Database
  let names: NamesRepository
  let asked: string[]
  let down: boolean
  let paced: number
  let now: number

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, createLogger('silent'))
    names = new NamesRepository(db)
    asked = []
    down = false
    paced = 0
    now = Date.parse('2026-10-24T10:00:00Z')
  })

  afterEach(() => db.close())

  const lookup = (artists: readonly string[]) =>
    new ArtistNameLookup({
      names,
      songs: { all: () => artists.map((artist, index) => song(index + 1, artist)) },
      deviceId: () => 'pi-aaaa1111',
      pace: new RateLimiter(1_100, {
        now: () => now,
        sleep: () => {
          paced++
          return Promise.resolve()
        },
      }),
      logger: createLogger('silent'),
      now: () => now,
      fetch: url => {
        const parsed = new URL(url)
        const key = parsed.pathname.endsWith('/artist')
          ? `search ${parsed.searchParams.get('query') ?? ''}`
          : `read ${parsed.pathname.split('/').pop() ?? ''}`
        asked.push(key)
        if (down) return Promise.resolve(new Response('busy', { status: 503 }))
        return Promise.resolve(Response.json(answers[key] ?? { artists: [] }))
      },
    })

  const named = (artist: string) => names.artistNamed(artist)?.names ?? null

  it('finds the names an artist also goes by, in scripts a person would type', async () => {
    expect(await lookup(['周杰伦', '幾田りら']).fill()).toBe(2)
    // Their own name left out, the Korean one too, the sort name said in its order.
    expect(named('周杰伦')).toEqual(['周杰倫', 'Jay Chou', 'ジェイ・チョウ', 'Chou Jay'])
    // The name she sings under in YOASOBI, and not the band.
    expect(named('幾田りら')).toEqual(['ikura', 'Lilas Ikuta', 'Ikuta Lilas'])
  })

  it('guesses at no one when two artists are written the same way', async () => {
    expect(await lookup(['ikura']).fill()).toBe(0)
    expect(named('ikura')).toBeNull()
    expect(asked).toEqual(['search ikura'])
  })

  it('stamps what it finds as the earliest change there is, so a person’s always wins', async () => {
    await lookup(['周杰伦']).fill()
    expect(names.artistNamed('周杰伦')?.hlc).toBe(
      formatHlc({ ms: 0, counter: 0, device: 'pi-aaaa1111' }),
    )
    const early = formatHlc({ ms: 1, counter: 0, device: 'iphone-bbbb2222' })
    expect(names.takeArtistNames('周杰伦', [], early)).toBe(true)
    expect(named('周杰伦')).toEqual([])
  })

  it('leaves alone an artist a person has named, even with nothing', async () => {
    names.takeArtistNames('周杰伦', [], formatHlc({ ms: now, counter: 0, device: 'mac-cccc3333' }))
    expect(await lookup(['周杰伦']).fill()).toBe(0)
    expect(asked).toEqual([])
  })

  it('asks about each artist once, and one with none again after a month', async () => {
    await lookup(['周杰伦', 'ikura']).fill()
    asked = []
    await lookup(['周杰伦', 'ikura']).fill()
    expect(asked).toEqual([])
    now += 31 * 24 * 60 * 60_000
    await lookup(['周杰伦', 'ikura']).fill()
    expect(asked).toEqual(['search ikura'])
  })

  it('stops when MusicBrainz does not answer, and asks again next time', async () => {
    down = true
    expect(await lookup(['周杰伦', '幾田りら']).fill()).toBe(0)
    expect(asked).toEqual(['search 周杰伦'])
    down = false
    expect(await lookup(['周杰伦', '幾田りら']).fill()).toBe(2)
  })

  it('keeps to MusicBrainz’s pace, a request a second', async () => {
    await lookup(['周杰伦', '幾田りら']).fill()
    // Four requests at one instant: the three after the first each wait their turn.
    expect(asked).toHaveLength(4)
    expect(paced).toBe(3)
  })
})
