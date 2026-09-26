import { describe, expect, it } from 'vitest'
import type { DeviceCommand, PlaybackState } from '@selfmp3/shared'
import { songIdTranslation } from '../connection/serverIds.js'
import { translateCommand, translateState } from './translate.js'
import { handoffTarget } from './handoff.js'

const NOW = 1_800_000_000_000

function state(patch: Partial<PlaybackState> = {}): PlaybackState {
  return {
    songId: 2,
    position: 40,
    playing: false,
    queueIds: [1, 2, 3],
    queueIndex: 1,
    shuffle: false,
    repeat: 'off',
    updatedAt: NOW,
    ...patch,
  }
}

/*
 * Three libraries that number the same songs differently, and — the whole
 * point — number *different* songs the same. Every uid below is held by one
 * number on the phone, another on the server and a third on the laptop, and
 * each of those numbers means something else in the other two.
 */
const PHONE = [
  { id: 1, uid: 'aaa' },
  { id: 2, uid: 'bbb' },
  { id: 3, uid: 'ccc' },
  { id: 9, uid: 'only-here' },
]
const SERVER = [
  { id: 3, uid: 'bbb' },
  { id: 7, uid: 'aaa' },
  { id: 8, uid: 'ccc' },
  { id: 2, uid: 'only-there' },
]
const LAPTOP = [
  { id: 1, uid: 'ccc' },
  { id: 2, uid: 'aaa' },
  { id: 3, uid: 'bbb' },
]

const phoneOut = songIdTranslation({ songs: PHONE }, { songs: SERVER }).onServer
const phoneIn = songIdTranslation({ songs: PHONE }, { songs: SERVER }).onDevice
const laptopIn = songIdTranslation({ songs: LAPTOP }, { songs: SERVER }).onDevice
const laptopOut = songIdTranslation({ songs: LAPTOP }, { songs: SERVER }).onServer

/** The uid a library's number stands for, which is the only fixed name a song has. */
const uidOn = (
  library: readonly { id: number; uid: string }[],
  id: number | null,
): string | null => (id === null ? null : (library.find(song => song.id === id)?.uid ?? null))

describe('translateState', () => {
  it('passes everything through when there is nothing to translate', () => {
    const original = state()
    expect(translateState(original, null)).toBe(original)
  })

  it('renumbers the song and its queue, keeping the index on the same song', () => {
    expect(translateState(state(), phoneOut)).toEqual(
      state({ songId: 3, queueIds: [7, 3, 8], queueIndex: 1 }),
    )
  })

  it('drops queue entries the other library has never heard of, and moves the index with them', () => {
    // 9 is only in the phone's library, so the server cannot be told about it.
    const out = translateState(state({ queueIds: [9, 1, 2], queueIndex: 2 }), phoneOut)
    expect(out.queueIds).toEqual([7, 3])
    expect(out.queueIndex).toBe(1)
    expect(out.songId).toBe(3)
  })

  it('keeps the index on the right copy of a song the queue holds twice', () => {
    const out = translateState(state({ queueIds: [2, 1, 2], queueIndex: 2 }), phoneOut)
    expect(out.queueIds).toEqual([3, 7, 3])
    expect(out.queueIndex).toBe(2)
  })

  it('says nothing rather than something wrong about a song the other side lacks', () => {
    const out = translateState(state({ songId: 9, queueIds: [9], queueIndex: 0 }), phoneOut)
    expect(out).toEqual(state({ songId: null, queueIds: [], queueIndex: -1 }))
    // Still a device, still playing — only the song is unsayable.
    expect(translateState(state({ songId: 9, playing: true }), phoneOut).playing).toBe(true)
  })

  it('blanks a state with no song rather than carrying a queue nothing points into', () => {
    expect(translateState(state({ songId: null }), phoneOut).queueIds).toEqual([])
  })

  it('carries nothing at all until both libraries have answered', () => {
    const notReady = songIdTranslation(undefined, { songs: SERVER })
    expect(notReady.ready).toBe(false)
    expect(translateState(state(), notReady.onServer).songId).toBeNull()
  })
})

describe('translateCommand', () => {
  type PlaySong = Extract<DeviceCommand, { type: 'playSong' }>
  const playSong = (patch: Partial<PlaySong> = {}): PlaySong => ({
    type: 'playSong',
    songId: 2,
    queueIds: [1, 2, 3],
    queueIndex: 1,
    play: true,
    ...patch,
  })

  it('leaves commands that carry no song alone', () => {
    for (const command of [
      { type: 'pause' },
      { type: 'seek', position: 12 },
      { type: 'transfer', fromDeviceId: 'device-one' },
    ] satisfies DeviceCommand[]) {
      expect(translateCommand(command, phoneOut)).toEqual(command)
    }
  })

  it('renumbers a playSong and its queue', () => {
    expect(translateCommand(playSong(), phoneOut)).toEqual({
      type: 'playSong',
      songId: 3,
      queueIds: [7, 3, 8],
      queueIndex: 1,
      play: true,
    })
  })

  it('refuses outright when the song has no translation', () => {
    expect(translateCommand(playSong({ songId: 9 }), phoneOut)).toBeNull()
  })

  it('refuses every playSong until both libraries have answered', () => {
    const notReady = songIdTranslation(undefined, undefined)
    expect(translateCommand(playSong(), notReady.onServer)).toBeNull()
  })

  it('leaves the index out rather than pointing it at another song', () => {
    // Position 0 is dropped, so the old index 0 has no counterpart.
    const out = translateCommand(playSong({ songId: 1, queueIds: [9, 1], queueIndex: 0 }), phoneOut)
    expect(out).toEqual({ type: 'playSong', songId: 7, queueIds: [7], play: true })
  })
})

/*
 * The failure this whole module exists to prevent.
 *
 * A handoff from the phone to the laptop passes through the server's
 * numbering, and every number involved means a different song in each of the
 * three libraries. What must come out the far end is the *same song* — the
 * same uid — and never a song that merely happens to hold that number there.
 */
describe('a handoff between two cloud devices', () => {
  it('lands on the same song, and on no other', () => {
    for (const uid of ['aaa', 'bbb', 'ccc']) {
      const here = PHONE.find(song => song.uid === uid)?.id ?? null
      const sent = translateState(
        state({ songId: here, queueIds: [1, 2, 3], queueIndex: 0 }),
        phoneOut,
      )
      const arrived = translateState(sent, laptopIn)
      expect(uidOn(LAPTOP, arrived.songId)).toBe(uid)

      // What the laptop would actually play, queue and all, is that same song.
      const target = handoffTarget(arrived, NOW)
      expect(target).not.toBeNull()
      if (!target) continue
      expect(uidOn(LAPTOP, target.queueIds[target.index] ?? null)).toBe(uid)
    }
  })

  it('never plays the song that happens to hold the same number here', () => {
    // The phone's song 2 is uid bbb. The laptop's song 2 is uid aaa. Passing the
    // number through untranslated would play aaa, which is the whole nightmare.
    const arrived = translateState(translateState(state({ songId: 2 }), phoneOut), laptopIn)
    expect(arrived.songId).toBe(3)
    expect(uidOn(LAPTOP, arrived.songId)).toBe('bbb')
    expect(uidOn(LAPTOP, 2)).toBe('aaa')
  })

  it('carries a command the same way, and refuses one it cannot carry', () => {
    const out = translateCommand({ type: 'playSong', songId: 3, queueIds: [1, 2, 3] }, laptopOut)
    expect(out).not.toBeNull()
    const arrived = out && translateCommand(out, phoneIn)
    expect(arrived?.type).toBe('playSong')
    expect(uidOn(PHONE, arrived?.type === 'playSong' ? arrived.songId : null)).toBe('bbb')

    // A song the server has never been given cannot be handed anywhere.
    expect(translateCommand({ type: 'playSong', songId: 9 }, phoneOut)).toBeNull()
  })

  it('leaves the far end with a queue of songs it really has', () => {
    const sent = translateState(state({ songId: 1, queueIds: [1, 9, 2], queueIndex: 0 }), phoneOut)
    const arrived = translateState(sent, laptopIn)
    // 9 was the phone's alone; it is simply not in the queue that arrives.
    expect(arrived.queueIds.map(id => uidOn(LAPTOP, id))).toEqual(['aaa', 'bbb'])
    expect(arrived.queueIndex).toBe(0)
  })

  it('drops a song the server has but this device does not, on the way in', () => {
    // `only-there` is song 2 on the server and nothing at all on the phone.
    const fromServer = state({ songId: 2, queueIds: [2, 3], queueIndex: 0 })
    expect(translateState(fromServer, phoneIn).songId).toBeNull()
    expect(translateState(state({ songId: 3, queueIds: [2, 3] }), phoneIn).queueIds).toEqual([2])
  })
})
