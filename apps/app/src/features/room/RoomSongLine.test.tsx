import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { roomTrackId } from '@selfmp3/client'
import {
  addRoomMember,
  applyRoomAction,
  DEFAULT_ROOM_RIGHTS,
  isRoomRefusal,
  newRoomDoc,
  roomStateFor,
  type RoomDoc,
  type RoomRefusal,
  type RoomSong,
  type RoomState,
  type Song,
} from '@selfmp3/shared'

import { RoomSongLine } from './RoomSongLine'

/**
 * Get it under a friend's song in Now Playing: pressed for one song, it says
 * so for that song only, not for the next friend's song drawn in its place.
 */

const X = 'aaaaaaaaaaaa'
const M = 'bbbbbbbbbbbb'

let mockState: RoomState | null = null
jest.mock('./room.store', () => ({ useRoom: () => ({ state: mockState, link: 'live' }) }))
jest.mock('../../player/roomTracks', () => ({ roomTrack: () => ({ yours: null }) }))
jest.mock('./RoomFace', () => ({ RoomFace: () => null }))
// The server takes what it is asked for; the hook keeps which links it was asked for.
jest.mock('./useGetSongs', () => {
  const { useState } = jest.requireActual<typeof import('react')>('react')
  return {
    useGetSongs: () => {
      const [getting, setGetting] = useState<ReadonlySet<string>>(new Set())
      return {
        reachable: true,
        getting,
        get: (asked: readonly { song: RoomSong }[]) => {
          setGetting(new Set([...getting, ...asked.map(({ song }) => song.sourceUrl ?? '')]))
          return Promise.resolve(true)
        },
      }
    },
  }
})

function roomSong(n: number): RoomSong {
  const sha = n.toString(16).padStart(2, '0').repeat(32)
  return {
    uid: sha.slice(0, 32),
    title: `Song ${n}`,
    artist: 'Someone',
    album: '',
    duration: 200,
    audio: { key: `audio/${sha}.m4a`, size: 1, mime: 'audio/mp4' },
    cover: null,
    coverTone: null,
    lyrics: null,
    sourceUrl: `https://youtu.be/song${n}`,
    link: null,
    artwork: null,
  }
}

let ids = 0
const newId = (): string => (++ids).toString(16).padStart(12, '0')
function ok(value: RoomDoc | RoomRefusal): RoomDoc {
  if (isRoomRefusal(value)) throw new Error(value.message)
  return value
}

/** Xiao's room, where Mia brought two songs Xiao does not have. */
function room(): { state: RoomState; first: number; second: number } {
  let doc = newRoomDoc({
    code: 'KQ7482',
    host: { id: X, name: 'Xiao', picture: null },
    mode: 'everyone',
    rights: DEFAULT_ROOM_RIGHTS,
    keepGoing: false,
    now: 0,
  })
  doc = ok(addRoomMember(doc, { id: M, name: 'Mia', kind: 'friend', picture: null }, 0))
  for (const n of [1, 2]) {
    doc = ok(applyRoomAction(doc, M, { type: 'add', song: roomSong(n) }, 0, newId))
  }
  const [first, second] = doc.entries.map(entry => roomTrackId(entry.id))
  if (first === undefined || second === undefined) throw new Error('no songs')
  return { state: roomStateFor(doc, X, 0), first, second }
}

const track = (id: number): Song => ({ id }) as unknown as Song

it('says Getting for the song asked for, and Get it again for the next one', async () => {
  const { state, first, second } = room()
  mockState = state
  const view = await render(<RoomSongLine song={track(first)} />)
  await act(async () => fireEvent.press(screen.getByTestId('now-playing-get-it')))
  expect(screen.getByTestId('now-playing-get-it')).toHaveTextContent('Getting')

  await view.rerender(<RoomSongLine song={track(second)} />)
  expect(screen.getByTestId('now-playing-get-it')).toHaveTextContent('Get it')
  expect(screen.getByTestId('now-playing-get-it')).not.toBeDisabled()
})
