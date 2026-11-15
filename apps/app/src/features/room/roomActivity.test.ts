import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  addRoomMember,
  applyRoomAction,
  DEFAULT_ROOM_RIGHTS,
  isRoomRefusal,
  newRoomDoc,
  roomStateFor,
  type RoomAction,
  type RoomDoc,
  type RoomRefusal,
  type RoomSong,
  type RoomState,
} from '@selfmp3/shared'
import { activityChanged, roomActivity } from './roomActivity.model'

/** What the Lock Screen and the Dynamic Island are handed for a room. */

const X = 'aaaaaaaaaaaa'
const M = 'bbbbbbbbbbbb'
const A = 'dddddddddddd'

const SHA = '7f'.repeat(32)

const song = (title: string, extra: Partial<RoomSong> = {}): RoomSong => ({
  uid: SHA.slice(0, 32),
  title,
  artist: 'YOASOBI',
  album: '',
  duration: 213,
  audio: { key: `audio/${SHA}.m4a`, size: 1, mime: 'audio/mp4' },
  cover: null,
  coverTone: null,
  lyrics: null,
  sourceUrl: null,
  link: null,
  artwork: null,
  ...extra,
})

let ids = 0
const newId = (): string => (++ids).toString(16).padStart(12, '0')

function ok(value: RoomDoc | RoomRefusal): RoomDoc {
  if (isRoomRefusal(value)) throw new Error(value.message)
  return value
}

const act = (doc: RoomDoc, who: string, action: RoomAction, now = 2000): RoomDoc =>
  ok(applyRoomAction(doc, who, action, now, newId))

function room(): RoomDoc {
  let doc = newRoomDoc({
    code: 'KQ7482',
    host: { id: X, name: 'Xiao', picture: null },
    mode: 'speaker',
    rights: DEFAULT_ROOM_RIGHTS,
    keepGoing: false,
    now: 1000,
  })
  doc = ok(addRoomMember(doc, { id: M, name: 'Mia', kind: 'friend', picture: null }, 1100))
  return doc
}

/** Mia adds アイドル and the host's player starts it. */
function playing(): RoomDoc {
  let doc = act(room(), M, { type: 'add', song: song('アイドル') })
  const entry = doc.entries[0]?.id ?? ''
  doc = act(doc, X, { type: 'report', entryId: entry, position: 0, playing: true }, 10_000)
  return doc
}

const as = (doc: RoomDoc, who: string): RoomState => roomStateFor(doc, who, 20_000)

const activity = (
  state: RoomState | null,
  extra: Partial<Parameters<typeof roomActivity>[0]> = {},
) => roomActivity({ state, offset: 0, link: 'live', coverOf: () => null, ...extra })

describe('the room’s Live Activity', () => {
  it('names the room and its code, and draws the others before you', () => {
    const shown = activity(as(room(), M))
    expect(shown?.head).toEqual({ code: 'KQ7482', title: "Xiao's room", codeLine: 'KQ7 482' })
    expect(shown?.state.here).toBe(2)
    expect(shown?.state.faces.map(face => face.letter)).toEqual(['X', 'M'])
    expect(shown?.state.faces[0]?.fill).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('shows the playing song, who added it, and when it started on this phone’s clock', () => {
    const shown = activity(as(playing(), X), { offset: 4000 })
    expect(shown?.state).toMatchObject({
      title: 'アイドル',
      artist: 'YOASOBI',
      by: 'Mia added it',
      playing: true,
      duration: 213,
      status: '',
    })
    // The doorman's 10 s is this phone's 6 s.
    expect(shown?.state.startedAt).toBeCloseTo(6, 3)
    expect(activity(as(playing(), M))?.state.by).toBe('You added it')
  })

  it('says what is missing: nothing playing yet, or the line down', () => {
    expect(activity(as(room(), X))?.state.status).toBe('Nothing playing. Add songs to start.')
    expect(activity(as(room(), M))?.state.status).toBe('Nothing playing yet')
    expect(activity(as(playing(), M), { link: 'offline' })?.state.status).toBe('Reconnecting…')
  })

  it('stands at the paused second, and asks for the cover only when a song plays', () => {
    const started = playing()
    const paused = act(started, X, {
      type: 'report',
      entryId: started.entries[0]?.id ?? '',
      position: 42,
      playing: false,
    })
    const shown = activity(as(paused, M), { coverOf: () => 'file:///covers/7.jpg' })
    expect(shown?.state).toMatchObject({ playing: false, position: 42 })
    expect(shown?.cover).toBe('file:///covers/7.jpg')
    expect(activity(as(room(), M), { coverOf: () => 'file:///x.jpg' })?.cover).toBeNull()
  })

  it('is gone when there is no room, or it has ended', () => {
    expect(activity(null)).toBeNull()
    const ended = act(room(), X, { type: 'end' })
    expect(activity(as(ended, M))).toBeNull()
  })
})

describe('when the Lock Screen is told', () => {
  const base = activity(as(playing(), M))

  it('is told of another song, someone joining, a seek or the room going', () => {
    const joined = ok(
      addRoomMember(playing(), { id: A, name: 'Ana', kind: 'guest', picture: null }, 1300),
    )
    expect(activityChanged(base, activity(as(joined, M)))).toBe(true)
    expect(activityChanged(base, activity(as(playing(), M), { offset: -5000 }))).toBe(true)
    expect(activityChanged(base, null)).toBe(true)
    expect(activityChanged(null, null)).toBe(false)
  })

  it('is not told the clock moved a little, which the bar takes care of', () => {
    expect(activityChanged(base, activity(as(playing(), M), { offset: -800 }))).toBe(false)
    expect(activityChanged(base, activity(as(playing(), M)))).toBe(false)
  })
})

describe('the Live Activity’s shape', () => {
  it('is one type in the app and in the widget that draws it', () => {
    // ActivityKit matches the two by this type, so they must not drift apart.
    const read = (path: string) =>
      readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
    expect(read('../../../targets/widget/RoomActivityAttributes.swift')).toBe(
      read('../../../modules/room-activity/ios/RoomActivityAttributes.swift'),
    )
  })
})
