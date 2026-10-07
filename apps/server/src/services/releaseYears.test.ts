import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrate } from '../db/migrate.js'
import { createLogger } from '../logger.js'
import { SongRepository } from '../repositories/songs.js'
import { SyncRepository } from '../repositories/sync.js'
import { LocalEdits, SyncClock } from './localEdits.js'
import { ReleaseYearService, releaseYearOf } from './releaseYears.js'
import type { FetchLike } from './fetching.js'
import { YouTubeMusicApi } from './youtubeMusicApi.js'

/** YouTube Music's `next` for a video, cut to what the pass reads. */
function nextResponse(videoId: string, byline: string, type = 'MUSIC_VIDEO_TYPE_ATV'): unknown {
  return {
    contents: {
      singleColumnMusicWatchNextResultsRenderer: {
        tabbedRenderer: {
          watchNextTabbedResultsRenderer: {
            tabs: [
              {
                tabRenderer: {
                  content: {
                    musicQueueRenderer: {
                      content: {
                        playlistPanelRenderer: {
                          contents: [
                            {
                              playlistPanelVideoRenderer: {
                                videoId,
                                longBylineText: {
                                  runs: byline.split(/( • )/).map(text => ({ text })),
                                },
                                navigationEndpoint: {
                                  watchEndpoint: {
                                    watchEndpointMusicSupportedConfigs: {
                                      watchEndpointMusicConfig: { musicVideoType: type },
                                    },
                                  },
                                },
                              },
                            },
                          ],
                        },
                      },
                    },
                  },
                },
              },
            ],
          },
        },
      },
    },
  }
}

describe('releaseYearOf', () => {
  const now = new Date('2026-10-04T12:00:00Z')

  it('reads the year at the end of an audio track’s line', () => {
    expect(releaseYearOf(nextResponse('a', '周杰倫 • 葉惠美 • 2003'), 'a', now)).toBe(2003)
  })

  it('says nothing for a music video, another video, or a line without a year', () => {
    const video = nextResponse('a', 'YOASOBI • 120M views', 'MUSIC_VIDEO_TYPE_OMV')
    expect(releaseYearOf(video, 'a', now)).toBeNull()
    expect(releaseYearOf(nextResponse('b', '周杰倫 • 葉惠美 • 2003'), 'a', now)).toBeNull()
    expect(releaseYearOf(nextResponse('a', '周杰倫 • 葉惠美'), 'a', now)).toBeNull()
    expect(releaseYearOf(nextResponse('a', 'X • Y • 2999'), 'a', now)).toBeNull()
    expect(releaseYearOf(null, 'a', now)).toBeNull()
  })
})

describe('ReleaseYearService', () => {
  let db: Database.Database
  let songs: SongRepository
  let sync: SyncRepository
  let edits: LocalEdits
  /** What YouTube Music answers for each video; missing is a failed request. */
  let answers: Map<string, unknown>
  let asked: string[]
  let changes: number

  const fakeFetch: FetchLike = (_url, init) => {
    const { videoId } = JSON.parse(String(init?.body)) as { videoId: string }
    asked.push(videoId)
    const answer = answers.get(videoId)
    return Promise.resolve(
      answer === undefined
        ? new Response('', { status: 503 })
        : new Response(JSON.stringify(answer), { status: 200 }),
    )
  }

  /** Every service made, so none is left asking again after its test. */
  let made: ReleaseYearService[]

  const service = (retryMs = 60_000): ReleaseYearService => {
    const years = new ReleaseYearService({
      songs,
      edits,
      logger: createLogger('silent'),
      onChange: () => changes++,
      api: new YouTubeMusicApi(createLogger('silent'), fakeFetch),
      gapMs: 0,
      retryMs,
    })
    made.push(years)
    return years
  }

  async function until(done: () => boolean): Promise<void> {
    for (let waited = 0; !done(); waited += 5) {
      if (waited > 2000) throw new Error('timed out')
      await new Promise(resolve => setTimeout(resolve, 5))
    }
  }

  function addSong(title: string, year: number | null, sourceUrl: string | null): number {
    return songs.insert({
      path: `${title}.m4a`,
      title,
      artist: 'Artist',
      album: '',
      albumArtist: '',
      trackNo: null,
      year,
      duration: 200,
      sizeBytes: 1000,
      mime: 'audio/mp4',
      mtimeMs: 1,
      hasArt: false,
      artExt: null,
      lyricsKind: 'none',
      sourceUrl,
    })
  }

  /** What the migration does to a library that is already here. */
  function listSongsToCheck(): void {
    db.exec(
      'INSERT INTO release_years_to_check (song_id) SELECT id FROM songs WHERE source_url IS NOT NULL',
    )
  }

  const left = (): number =>
    (db.prepare('SELECT COUNT(*) AS n FROM release_years_to_check').get() as { n: number }).n
  const yearOf = (id: number): number | null => songs.byId(id)?.year ?? null
  const stamped = (id: number): boolean => {
    const uid = sync.uids('songs', [id]).get(id)
    return uid !== undefined && sync.stamp('song', uid, 'year') !== null
  }

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    migrate(db, createLogger('silent'))
    songs = new SongRepository(db)
    sync = new SyncRepository(db)
    const clock = new SyncClock({
      deviceId: () => 'mac-aaaa1111',
      latest: () => sync.latestStamp(),
    })
    edits = new LocalEdits({ db, sync, clock })
    answers = new Map()
    asked = []
    changes = 0
    made = []
  })

  afterEach(() => {
    for (const one of made) one.stop()
    db.close()
  })

  it('gives each song the year it came out, as an edit that syncs, and never asks again', async () => {
    const sunny = addSong('晴天', 2019, 'https://music.youtube.com/watch?v=SJKoWAd5ySo')
    const right = addSong('Lemon', 2018, 'https://music.youtube.com/watch?v=3NNhrqHZqlI')
    const video = addSong('MV', 2021, 'https://www.youtube.com/watch?v=omv00000001')
    const file = addSong('From a folder', 2010, null)
    answers.set('SJKoWAd5ySo', nextResponse('SJKoWAd5ySo', '周杰倫 • 葉惠美 • 2003'))
    answers.set('3NNhrqHZqlI', nextResponse('3NNhrqHZqlI', 'Kenshi Yonezu • Lemon • 2018'))
    answers.set(
      'omv00000001',
      nextResponse('omv00000001', 'Someone • 2M views', 'MUSIC_VIDEO_TYPE_OMV'),
    )
    listSongsToCheck()

    await service().start()

    expect(yearOf(sunny)).toBe(2003)
    expect(stamped(sunny)).toBe(true)
    // Already right, or nothing to go on: left as it was, and not stamped.
    expect(yearOf(right)).toBe(2018)
    expect(stamped(right)).toBe(false)
    expect(yearOf(video)).toBe(2021)
    expect(yearOf(file)).toBe(2010)
    expect(changes).toBe(1)
    expect(left()).toBe(0)

    asked = []
    await service().start()
    expect(asked).toEqual([])
  })

  it('leaves a year someone typed alone', async () => {
    const id = addSong('晴天', 2004, 'https://music.youtube.com/watch?v=SJKoWAd5ySo')
    songs.patch(id, { year: 2004 })
    edits.songs([id], ['year'])
    answers.set('SJKoWAd5ySo', nextResponse('SJKoWAd5ySo', '周杰倫 • 葉惠美 • 2003'))
    listSongsToCheck()

    await service().start()

    expect(yearOf(id)).toBe(2004)
    expect(asked).toEqual([])
    expect(left()).toBe(0)
  })

  it('stops when nothing answers, and asks again by itself later', async () => {
    const ids = Array.from({ length: 8 }, (_, n) =>
      addSong(`Song ${n}`, 2020, `https://music.youtube.com/watch?v=vid0000000${n}`),
    )
    answers.set('vid00000000', nextResponse('vid00000000', 'A • B • 1999'))
    listSongsToCheck()

    const years = service(20)
    await years.start()

    expect(yearOf(ids[0]!)).toBe(1999)
    // The first answered; the next five did not, so the last two were never asked.
    expect(asked).toHaveLength(6)
    expect(left()).toBe(7)

    for (let n = 1; n < 8; n++) {
      answers.set(`vid0000000${n}`, nextResponse(`vid0000000${n}`, 'A • B • 2001'))
    }
    await until(() => left() === 0)
    expect(ids.map(yearOf)).toEqual([1999, 2001, 2001, 2001, 2001, 2001, 2001, 2001])
  })

  it('lets a song go after a few rounds where only it went unanswered', async () => {
    const answered = addSong('Answered', 2020, 'https://music.youtube.com/watch?v=vid00000000')
    const silent = addSong('Silent', 2020, 'https://music.youtube.com/watch?v=vid00000001')
    answers.set('vid00000000', nextResponse('vid00000000', 'A • B • 1999'))
    listSongsToCheck()

    await service(5).start()
    await until(() => left() === 0)

    expect(yearOf(answered)).toBe(1999)
    expect(yearOf(silent)).toBe(2020)
    // One round with both, then two more for the silent song alone.
    expect(asked.filter(id => id === 'vid00000001')).toHaveLength(3)
  })
})
