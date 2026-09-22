import { useEffect } from 'react'
import { act, render } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Library, Song } from '@selfmp3/shared'
import type { EngineState, EngineWiring, PlaybackEngine } from '@selfmp3/client'

import { PlayerProvider, usePlayer, type PlayerApi } from './PlayerProvider'

/**
 * The queue the commands read is the queue the last command left.
 *
 * Every command reads `queueRef` and the engine asks it for the lookahead, so
 * the ref has to be right the moment a command returns. It used to be filled
 * in by an effect after the render, and two commands in one tick — a headset's
 * double-tap, a drop into Up next that skips and then adds — both saw the queue
 * from before the first. These render the real provider over a fake engine, so
 * they prove the commit itself rather than the model behind it.
 */

// The engine is the outermost boundary here: what it is handed, and what it
// asks back through the wiring, is the whole of what the provider does to it.
const IDLE: EngineState = {
  playing: false,
  currentTime: 0,
  duration: 0,
  buffered: 0,
  volume: 1,
  muted: false,
  rate: 1,
  stalled: false,
  error: null,
  preservesPitch: true,
  loopA: null,
  loopB: null,
  countingIn: false,
}

const mockWiring: Partial<EngineWiring> = {}
const mockEngine = {
  capabilities: {
    crossfade: false,
    analyser: false,
    pitchLock: false,
    loop: false,
    lockScreen: false,
    nativeQueue: false,
  },
  state: IDLE,
  currentSongId: null as number | null,
  playhead: 0,
  subscribe: () => () => undefined,
  configure: jest.fn(),
  load: jest.fn((songId: number) => {
    mockEngine.currentSongId = songId
    return Promise.resolve()
  }),
  play: jest.fn(() => Promise.resolve()),
  pause: jest.fn(),
  seek: jest.fn(),
  setVolume: jest.fn(),
  setMuted: jest.fn(),
  setRate: jest.fn(),
  setPreservesPitch: jest.fn(),
  setLoop: jest.fn(),
  clearLoop: jest.fn(),
  setCountIn: jest.fn(),
  analyser: () => null,
  destroy: jest.fn(),
  connect: (wiring: Partial<EngineWiring>) => {
    Object.assign(mockWiring, wiring)
    return () => undefined
  },
  onTrackEnd: null,
  nextTrackId: null,
  streamUrl: null,
  streamHeaders: null,
  trackMetadata: null,
  onProgress: null,
} satisfies PlaybackEngine

jest.mock('../ports/engine', () => ({ createEngine: () => mockEngine }))
jest.mock('../connection/ConnectionProvider', () => ({
  useConnection: () => ({ connection: null, fromCloud: false }),
}))
jest.mock('@selfmp3/client', () => ({
  ...jest.requireActual('@selfmp3/client'),
  useLibrary: () => ({ data: mockLibrary }),
  useSettings: () => ({ data: undefined }),
}))
// Every song may play, at once: the checks under test are the queue's, not the disk's.
jest.mock('../offline/DownloadsProvider', () => ({
  useDownloads: () => ({
    queue: { localUri: () => null },
    checkPlay: () => true,
    mayPlay: () => true,
    keepPlayed: jest.fn(),
  }),
}))
// The cloud session and the kept covers are disk and network; nothing here reaches either.
jest.mock('../replica', () => ({
  session: { loadSession: () => Promise.resolve(null) },
  cloudPlatform: { doormanUrl: '' },
}))
jest.mock('../offline/covers', () => ({
  coverFor: () => undefined,
  coversNow: () => new Map(),
  coversVersion: () => 0,
  subscribeCovers: () => () => undefined,
  KEPT_COVER_SIZE: 640,
}))
jest.mock('../api/client', () => ({ mediaUrlFor: jest.fn() }))

const song = (id: number): Song =>
  ({
    id,
    title: `Song ${id}`,
    artist: 'Artist',
    album: '',
    path: `audio/${id}.m4a`,
    duration: 200,
    sizeBytes: 1000,
    missing: false,
    loved: false,
    hasArt: false,
    tagIds: [],
    playCount: 0,
  }) as unknown as Song

const SONGS = [1, 2, 3, 4]
const mockLibrary = { songs: SONGS.map(song), playlists: [], tags: [] } as unknown as Library

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

beforeEach(() => {
  jest.clearAllMocks()
  mockEngine.currentSongId = null
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
