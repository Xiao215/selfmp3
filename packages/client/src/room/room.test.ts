import { describe, expect, it } from 'vitest'
import type { RoomEntry, RoomSong, Song } from '@selfmp3/shared'
import { createRoomApi, publicServerBase, RoomError } from './roomApi.js'
import { clockOffset, shouldResync, withClockSample, CLOCK_SAMPLES } from './roomClock.js'
import { isRoomTrackId, libraryIndex, roomTrackId, roomTrackSong, yoursOf } from './roomTracks.js'

/**
 * A room from a device: its addresses, the doorman's clock as seen from here,
 * and a friend's song as a track the player can hold.
 */

const SHA = 'ab'.repeat(32)

const SONG: RoomSong = {
  uid: 'cd'.repeat(16),
  title: 'ヒッチコック',
  artist: 'ヨルシカ',
  album: '',
  duration: 263,
  audio: { key: `audio/${SHA}.m4a`, size: 4000, mime: 'audio/mp4' },
  cover: { key: `covers/${SHA}.jpg`, size: 0 },
  coverTone: null,
  lyrics: null,
  sourceUrl: 'https://music.youtube.com/watch?v=abc',
  link: null,
  artwork: null,
}

const ENTRY: RoomEntry = {
  id: '0000000000ff',
  song: SONG,
  addedBy: 'bbbbbbbbbbbb',
  owner: 'bbbbbbbbbbbb',
  from: null,
  addedAt: Date.parse('2026-10-12T20:00:00Z'),
  at: null,
  playedAt: null,
}

const PASS = { code: 'KQ7482', member: 'aaaaaaaaaaaa', token: 'f'.repeat(32) }

describe('a room’s addresses', () => {
  const api = createRoomApi('https://doorman.example/', () => Promise.reject(new Error('unused')))

  it('carry the member’s token, for a socket and for a song’s file', () => {
    expect(api.socketUrl(PASS)).toBe(`wss://doorman.example/v1/rooms/KQ7482/socket?t=${PASS.token}`)
    expect(api.fileUrl(PASS, ENTRY.id, 'audio')).toBe(
      `https://doorman.example/v1/rooms/KQ7482/files/0000000000ff/audio?t=${PASS.token}`,
    )
  })

  it('send a song’s owner’s session with an add, and say what the room said when it refuses', async () => {
    const seen: Array<{ url: string; headers?: Record<string, string> }> = []
    const refusing = createRoomApi('https://doorman.example', (url, init) => {
      seen.push({ url, ...(init?.headers ? { headers: init.headers } : {}) })
      return Promise.resolve({
        ok: false,
        status: 403,
        json: () =>
          Promise.resolve({ error: 'the host has not allowed that', code: 'room_forbidden' }),
      })
    })
    const refused = await refusing
      .act(PASS, { type: 'add', song: SONG }, 'session-token')
      .catch(e => e)
    expect(refused).toBeInstanceOf(RoomError)
    expect(refused).toMatchObject({ status: 403, code: 'room_forbidden', gone: false })
    expect(seen[0]?.headers?.['authorization']).toBe('Bearer session-token')
    expect(new RoomError(410, 'room_ended', 'ended').gone).toBe(true)
  })
})

describe('the doorman’s clock', () => {
  it('believes the sample with the shortest round trip', () => {
    let samples = withClockSample([], { sentAt: 1000, receivedAt: 1400, serverTime: 5000 })
    samples = withClockSample(samples, { sentAt: 2000, receivedAt: 2040, serverTime: 6100 })
    // 6100 - 2020: the doorman runs 4080 ms ahead.
    expect(clockOffset(samples)).toBe(4080)
    expect(clockOffset([])).toBe(0)
  })

  it('keeps only the newest few, and ignores a sample from a clock that went backwards', () => {
    let samples: ReturnType<typeof withClockSample> = []
    for (let index = 0; index < 10; index++) {
      samples = withClockSample(samples, { sentAt: index, receivedAt: index + 1, serverTime: 0 })
    }
    expect(samples).toHaveLength(CLOCK_SAMPLES)
    expect(withClockSample(samples, { sentAt: 5, receivedAt: 1, serverTime: 0 })).toHaveLength(
      CLOCK_SAMPLES,
    )
  })

  it('catches up only when the drift is one a listener would hear', () => {
    expect(shouldResync(10, 10.2)).toBe(false)
    expect(shouldResync(10, 10.5)).toBe(true)
  })
})

describe('a room’s song as a track', () => {
  it('has a negative id of its own, the same every time', () => {
    expect(roomTrackId(ENTRY.id)).toBe(-256)
    expect(roomTrackId('ffffffffffff')).toBeLessThan(0)
    expect(Number.isSafeInteger(roomTrackId('ffffffffffff'))).toBe(true)
    expect(isRoomTrackId(roomTrackId(ENTRY.id))).toBe(true)
    expect(isRoomTrackId(5)).toBe(false)
  })

  it('reads as a song, with its picture and its words', () => {
    expect(roomTrackSong(ENTRY)).toMatchObject({
      id: -256,
      title: 'ヒッチコック',
      hasArt: true,
      lyricsKind: 'none',
      tagIds: [],
    })
  })

  it('is found in your own library by its file, or by where it came from', () => {
    const mine = (id: number, path: string, sourceUrl: string | null) =>
      ({ id, path, sourceUrl }) as Song
    const sameFile = libraryIndex([mine(7, SONG.audio?.key ?? '', null)])
    expect(yoursOf(SONG, sameFile)).toBe(7)
    const sameLink = libraryIndex([mine(9, `audio/${'cd'.repeat(32)}.m4a`, SONG.sourceUrl)])
    expect(yoursOf(SONG, sameLink)).toBe(9)
    // The same video under another spelling of its link is still yours.
    const otherSpelling = libraryIndex([
      mine(11, 'Music/a.m4a', 'https://youtu.be/by4SYYWlhEs?si=x'),
    ])
    const video = { ...SONG, sourceUrl: 'https://music.youtube.com/watch?v=by4SYYWlhEs' }
    expect(yoursOf(video, otherSpelling)).toBe(11)
    expect(yoursOf(SONG, libraryIndex([]))).toBeNull()
  })
})

describe('the host’s server, for links', () => {
  it('is reached at its public name, never a home or tailnet address', () => {
    expect(
      publicServerBase([
        'http://localhost:4600',
        'http://10.0.0.190:4600',
        'http://100.75.87.109:4600',
        'https://100.75.87.109',
        'https://pi.tail3d8516.ts.net/',
      ]),
    ).toBe('https://pi.tail3d8516.ts.net')
    expect(publicServerBase(['http://10.0.0.190:4600'])).toBeNull()
  })
})
