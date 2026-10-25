import { useEffect } from 'react'
import { act, render } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Library, Song } from '@selfmp3/shared'
import type { EngineState, EngineWiring, PlaybackEngine } from '@selfmp3/client'

import { PlayerProvider, usePlayer, type PlayerApi } from './PlayerProvider'
import { setRoomTracks } from './roomTracks'

/**
 * The queue the commands read is the queue the last command left.
 *
 * Every command reads `queueRef` and the engine asks it for the lookahead, so
 * the ref has to be right the moment a command returns, or two commands in one
 * tick — a headset's double-tap, a drop into Up next that skips and then adds —
 * both see the queue from before the first. These render the real provider over a fake engine, so
 * they prove the commit itself rather than the model behind it.
 */

// The engine is the outermost boundary here: what it is handed, and what it
// asks back through the wiring, is the whole of what the provider does to it.
const IDLE: EngineState = {
  playing: false,
  currentTime: 0,
  duration: 0,
  volume: 1,
  muted: false,
  stalled: false,
  error: null,
}

const mockWiring: Partial<EngineWiring> = {}
let mockEngineListener: ((state: EngineState) => void) | null = null
const mockKeepPlayed = jest.fn()
const mockKeepAhead = jest.fn((_songId: number) => Promise.resolve(false))
const mockEngine = {
  capabilities: {
    crossfade: false,
    analyser: false,
  },
  state: IDLE as EngineState,
  currentSongId: null as number | null,
  playhead: 0,
  subscribe: (listener: (state: EngineState) => void) => {
    mockEngineListener = listener
    return () => undefined
  },
  configure: jest.fn(),
  load: jest.fn((songId: number) => {
    mockEngine.currentSongId = songId
    // As both engines do: a load clears the last one's error before anything else.
    mockEngineListener?.(IDLE)
    return Promise.resolve()
  }),
  play: jest.fn(() => Promise.resolve()),
  pause: jest.fn(),
  seek: jest.fn(),
  setVolume: jest.fn(),
  setMuted: jest.fn(),
  refreshLookahead: jest.fn(),
  analyser: () => null,
  destroy: jest.fn(),
  connect: (wiring: Partial<EngineWiring>) => {
    Object.assign(mockWiring, wiring)
    return () => undefined
  },
} satisfies PlaybackEngine

jest.mock('../ports/engine', () => ({ createEngine: () => mockEngine }))
jest.mock('../connection/ConnectionProvider', () => ({
  useConnection: () => ({ connection: null, fromCloud: false }),
}))
jest.mock('@selfmp3/client', () => ({
  ...jest.requireActual('@selfmp3/client'),
  useLibrary: () => ({ data: mockLibrary }),
}))
// Every song may play, at once: the checks under test are the queue's, not the disk's.
jest.mock('../offline/DownloadsProvider', () => ({
  useDownloads: () => ({
    queue: { localUri: () => null },
    checkPlay: () => true,
    mayPlay: () => true,
    keepPlayed: mockKeepPlayed,
    keepAhead: mockKeepAhead,
  }),
}))
// The cloud session and the kept covers are disk and network; nothing here reaches either.
jest.mock('../replica', () => ({
  session: { loadSession: () => Promise.resolve(null) },
  cloudPlatform: { doormanUrl: '' },
  doormanFileUrl: (key: string) => `https://doorman.example/v1/files/${key}`,
  doormanAuth: (token: string) => ({ Authorization: `Bearer ${token}` }),
}))
jest.mock('../offline/covers', () => ({
  coverFor: () => undefined,
  coversVersion: () => 0,
  subscribeCovers: () => () => undefined,
  KEPT_COVER_SIZE: 640,
}))
jest.mock('../api/client', () => ({ mediaUrlFor: jest.fn() }))
// The room this device is in, as far as the player asks: whether it can still hear it.
const mockRoom = {
  view: { pass: null as object | null, link: 'live' as 'connecting' | 'live' | 'offline' },
  alive: true,
  listeners: new Set<() => void>(),
}
jest.mock('../features/room/room.store', () => ({
  currentRoom: () => mockRoom.view,
  checkRoomLink: () => Promise.resolve(mockRoom.alive),
  subscribeRoom: (listener: () => void) => {
    mockRoom.listeners.add(listener)
    return () => mockRoom.listeners.delete(listener)
  },
}))

const song = (id: number): Song =>
  ({
    id,
    title: `Song ${id}`,
    artist: 'Artist',
    album: '',
    path: `audio/${id}.m4a`,
    duration: 200,
    sizeBytes: 1000,
    loved: false,
    hasArt: false,
    tagIds: [],
    playCount: 0,
  }) as unknown as Song

const SONGS = [1, 2, 3, 4]
const mockLibrary = { songs: SONGS.map(song), playlists: [], tags: [] } as unknown as {
  songs: Song[]
} & Library

let api: PlayerApi
function Probe(): null {
  const player = usePlayer()
  useEffect(() => {
    api = player
  })
  return null
}

const draw = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PlayerProvider>
        <Probe />
      </PlayerProvider>
    </QueryClientProvider>,
  )

/** The engine's ticks for this many seconds of the song, from its top. */
const listen = (seconds: number): void => {
  for (let at = 1; at <= seconds; at++) mockWiring.onProgress?.(at, 200)
}

beforeEach(() => {
  jest.clearAllMocks()
  mockEngine.currentSongId = null
  mockEngine.state = IDLE
  mockLibrary.songs = SONGS.map(song)
  mockRoom.view = { pass: null, link: 'live' }
  mockRoom.alive = true
  setRoomTracks(new Map())
})

describe('the queue as the commands see it', () => {
  it('advances two songs for two presses of Next in one tick', async () => {
    await draw()
    await act(() => api.playFrom(SONGS, 0))
    expect(api.current?.id).toBe(1)

    // A headset's double-tap: both presses land before React renders either.
    await act(() => {
      api.next()
      api.next()
    })

    expect(api.current?.id).toBe(3)
    expect(api.queue.index).toBe(2)
    expect(mockEngine.load).toHaveBeenLastCalledWith(3, { autoplay: false })
  })

  it('tells the lookahead the song after the new one, straight after Next', async () => {
    await draw()
    await act(() => api.playFrom(SONGS, 0))

    // The phone's engine asks for its lookahead as soon as it is told to skip.
    let lookahead: number | null | undefined
    await act(() => {
      api.next()
      lookahead = mockWiring.nextTrackId?.()
    })

    expect(api.current?.id).toBe(2)
    expect(lookahead).toBe(3)
  })

  it('sees a song added right after a skip land behind the song skipped to', async () => {
    await draw()
    await act(() => api.playFrom([1, 2], 0))

    // A drop into Up next: skip, then add, in one gesture's handler.
    await act(() => {
      api.next()
      api.addToQueue([3])
    })

    expect(api.current?.id).toBe(2)
    expect([...api.queue.items]).toEqual([1, 2, 3])
  })

  it('starts the song again on repeat-one when it ends, rather than moving on', async () => {
    await draw()
    await act(() => api.playFrom([1, 2], 0))
    await act(() => {
      api.cycleRepeatMode()
      api.cycleRepeatMode()
    })
    expect(api.queue.repeat).toBe('one')
    mockEngine.load.mockClear()

    await act(() => mockWiring.onTrackEnd?.())

    // Restarted in place: seeked to the top, not loaded as a new song.
    expect(api.current?.id).toBe(1)
    expect(mockEngine.seek).toHaveBeenCalledWith(0)
    expect(mockEngine.play).toHaveBeenCalled()
    expect(mockEngine.load).not.toHaveBeenCalled()
  })

  it('moves on when a song ends with repeat off', async () => {
    await draw()
    await act(() => api.playFrom([1, 2], 0))
    mockEngine.load.mockClear()

    await act(() => mockWiring.onTrackEnd?.())

    expect(api.current?.id).toBe(2)
    expect(mockEngine.load).toHaveBeenLastCalledWith(2, { autoplay: true })
  })
})

describe('keeping songs where they stream from the bucket', () => {
  it('keeps the song that counted and the one after it, and lends that one again once kept', async () => {
    mockKeepAhead.mockImplementation(() => Promise.resolve(true))
    await draw()
    await act(() => api.playFrom([1, 2, 3], 0))

    // A song that ran out counts, once some of it was heard.
    await act(() => listen(5))
    await act(() => mockWiring.onTrackEnd?.())

    expect(mockKeepPlayed).toHaveBeenCalledWith(1)
    expect(mockKeepAhead).toHaveBeenCalledWith(2)
    // Kept on the disk: the player is told to take it from there.
    await act(() => Promise.resolve())
    expect(mockEngine.refreshLookahead).toHaveBeenCalled()
  })

  it('lends nothing again when the next song could not be kept', async () => {
    mockKeepAhead.mockImplementation(() => Promise.resolve(false))
    await draw()
    await act(() => api.playFrom([1, 2], 0))
    mockEngine.refreshLookahead.mockClear()

    await act(() => listen(5))
    await act(() => mockWiring.onTrackEnd?.())
    await act(() => Promise.resolve())

    expect(mockKeepAhead).toHaveBeenCalledWith(2)
    // Asked again by the move to song 2, as it always was, and not for a copy.
    const calls = mockEngine.refreshLookahead.mock.calls.length
    await act(() => Promise.resolve())
    expect(mockEngine.refreshLookahead.mock.calls.length).toBe(calls)
  })
})

describe('songs leaving the library', () => {
  it('stops on the next song, paused, when the playing song is removed', async () => {
    await draw()
    await act(() => api.playFrom(SONGS, 1))
    mockEngine.load.mockClear()

    await act(() => api.forgetSongs([2]))

    expect(mockEngine.pause).toHaveBeenCalled()
    expect([...api.queue.items]).toEqual([1, 3, 4])
    expect(api.current?.id).toBe(3)
    expect(mockEngine.load).toHaveBeenLastCalledWith(3, { autoplay: false })
  })

  it('leaves nothing to play when the removed song was the last', async () => {
    await draw()
    await act(() => api.playFrom([1, 2], 1))

    await act(() => api.forgetSongs([2]))

    expect(mockEngine.pause).toHaveBeenCalled()
    expect(api.current).toBeNull()
    // Play/pause has nothing to start again: not the removed song the engine still holds.
    mockEngine.play.mockClear()
    await act(() => api.toggle())
    expect(mockEngine.play).not.toHaveBeenCalled()
  })

  it('keeps playing when only a later song is removed', async () => {
    await draw()
    await act(() => api.playFrom(SONGS, 0))
    mockEngine.load.mockClear()

    await act(() => api.forgetSongs([3]))

    expect(mockEngine.pause).not.toHaveBeenCalled()
    expect(mockEngine.load).not.toHaveBeenCalled()
    expect([...api.queue.items]).toEqual([1, 2, 4])
    expect(api.current?.id).toBe(1)
  })
})

describe('a room’s song that stops', () => {
  const roomSongs = (): void =>
    setRoomTracks(
      new Map(
        [-1, -2].map(id => [
          id,
          {
            song: song(id),
            stream: { url: `https://doorman.example/rooms/files/${id}`, headers: null },
            cover: null,
            yours: null,
          },
        ]),
      ),
    )
  const fails = (): void => mockEngineListener?.({ ...IDLE, error: 'network' })

  it('waits out a connection the room lost, and goes on once it is back', async () => {
    roomSongs()
    mockRoom.view = { pass: {}, link: 'live' }
    mockRoom.alive = false
    await draw()
    await act(() => api.playFrom([-1, -2], 0))
    mockEngine.load.mockClear()

    await act(async () => fails())

    // Not skipped down the room's list, and not tried again into a dead line.
    expect(api.current?.id).toBe(-1)
    expect(mockEngine.load).not.toHaveBeenCalled()

    mockRoom.view = { pass: {}, link: 'live' }
    await act(async () => {
      for (const listener of mockRoom.listeners) listener()
    })
    expect(mockEngine.load).toHaveBeenCalledWith(-1, { autoplay: true })
  })

  it('is tried again as any song is when the room still hears this device', async () => {
    roomSongs()
    mockRoom.view = { pass: {}, link: 'live' }
    await draw()
    await act(() => api.playFrom([-1, -2], 0))
    mockEngine.load.mockClear()

    await act(async () => fails())

    expect(mockEngine.load).toHaveBeenCalledWith(-1, { autoplay: true })
  })
})

describe('a run of songs that will not play', () => {
  /** The engine saying the song it holds failed, as it does once per load. */
  const fails = (error = 'This song isn’t on this computer'): void => {
    mockEngine.currentSongId = null
    mockEngineListener?.({ ...IDLE, error })
  }
  /** The ids loaded, in order. */
  const loaded = (): number[] => mockEngine.load.mock.calls.map(([id]) => id)

  it('tries a song again, then skips, and stops after three skips', async () => {
    await draw()
    await act(() =>
      api.playFrom(
        [1, 2, 3, 4, 1, 2, 3, 4].map((id, at) => id + at * 10),
        0,
      ),
    )
    mockEngine.load.mockClear()

    // Each song fails, and each failure is told twice, in other words, the
    // second time late: that is one failure, not two.
    for (let failure = 0; failure < 12; failure++) {
      await act(async () => {
        fails()
        fails('Failed to load because no supported source was found.')
      })
    }

    // A retry and a skip for each of three songs, then the fourth's retry: stopped there.
    expect(loaded()).toEqual([1, 12, 12, 23, 23, 34, 34])
    expect(api.queue.items[api.queue.index]).toBe(34)
    expect(mockEngine.pause).toHaveBeenCalled()
  })

  it('stops with Repeat all on too, rather than going round forever', async () => {
    await draw()
    await act(() => api.playFrom([1, 2], 0))
    await act(() => api.cycleRepeatMode())
    expect(api.queue.repeat).toBe('all')
    mockEngine.load.mockClear()

    for (let failure = 0; failure < 20; failure++) await act(async () => fails())

    expect(mockEngine.load.mock.calls.length).toBe(7)
  })

  it('stops after the retry when nothing answers, leaving Up next as it was', async () => {
    await draw()
    await act(() => api.playFrom(SONGS, 0))
    mockEngine.load.mockClear()

    for (let failure = 0; failure < 5; failure++) {
      await act(async () => fails('Lost connection to the library'))
    }

    expect(loaded()).toEqual([1])
    expect(api.current?.id).toBe(1)
  })

  it('leaves a song put back paused alone when it fails: no retry, no skip', async () => {
    await draw()
    await act(() => api.playFrom(SONGS, 1, { autoplay: false, position: 42 }))
    mockEngine.load.mockClear()

    await act(async () => fails())

    expect(mockEngine.load).not.toHaveBeenCalled()
    expect(api.current?.id).toBe(2)
  })

  it('keeps a Pause pressed while songs fail', async () => {
    await draw()
    await act(() => api.playFrom(SONGS, 0))
    // Playing for the moment between one failure and the next.
    mockEngine.state = { ...IDLE, playing: true }
    await act(() => api.toggle())
    mockEngine.state = IDLE
    mockEngine.load.mockClear()

    await act(async () => fails())

    expect(mockEngine.load).not.toHaveBeenCalled()
    expect(api.current?.id).toBe(1)
  })

  it('asks for a failed song again when Play is pressed, from where it was', async () => {
    await draw()
    await act(() => api.playFrom(SONGS, 0, { autoplay: false }))
    await act(() => listen(3))
    await act(async () => fails())
    mockEngine.load.mockClear()
    mockEngine.play.mockClear()

    await act(() => api.toggle())

    expect(mockEngine.load).toHaveBeenCalledWith(1, { autoplay: true, startAt: 3 })
    expect(mockEngine.play).not.toHaveBeenCalled()
  })

  it('counts no play for a song that failed and was moved past', async () => {
    await draw()
    await act(() => api.playFrom(SONGS, 0))

    // The phone's player moving on from a failed song reads as it ending.
    await act(() => mockWiring.onTrackEnd?.())

    expect(mockKeepPlayed).not.toHaveBeenCalled()
  })
})

describe('songs deleted on another device', () => {
  it('stops the song playing when the library no longer has it, and takes them out of Up next', async () => {
    const view = await draw()
    await act(() => api.playFrom(SONGS, 0))
    mockEngine.load.mockClear()

    // The library comes back without songs 1 and 4.
    mockLibrary.songs = [2, 3].map(song)
    await view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <PlayerProvider>
          <Probe />
        </PlayerProvider>
      </QueryClientProvider>,
    )

    expect(mockEngine.pause).toHaveBeenCalled()
    expect([...api.queue.items]).toEqual([2, 3])
    expect(mockEngine.load).toHaveBeenLastCalledWith(2, { autoplay: false })
  })
})
