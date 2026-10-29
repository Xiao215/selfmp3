import { act, renderHook } from '@testing-library/react-native'
import { useListen } from './ImportListen'

/**
 * A song heard from this device's own download, which takes a moment to
 * come: a tap meanwhile pauses it, and it waits for the next tap to play.
 */

const mockAudio = {
  play: jest.fn(),
  pause: jest.fn(),
  resume: jest.fn(),
  stop: jest.fn(),
  seek: jest.fn(),
  dispose: jest.fn(),
  subscribe: () => () => undefined,
}
jest.mock('../../ports/listen', () => ({ createListenAudio: () => mockAudio }))
jest.mock('../../player/PlayerProvider', () => ({
  usePlayerCommands: () => ({ toggle: () => undefined }),
  usePlayerPlaying: () => false,
}))
jest.mock('../../connection/ConnectionProvider', () => ({
  useConnection: () => ({ connection: { baseUrl: 'http://server', token: null } }),
}))
jest.mock('../../api/client', () => ({
  mediaUrlFor: () => ({ importListen: (url: string) => `server:${url}` }),
}))
let mockArrive: (source: string) => void = () => undefined
jest.mock('./deviceImports', () => ({
  listenSource: () => new Promise<string>(resolve => (mockArrive = resolve)),
}))

const TRACK = {
  url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa',
  title: 'Song',
  artist: 'Artist',
  duration: 200,
  thumbnail: null,
}

describe('a song heard from this device’s own download', () => {
  beforeEach(() => jest.clearAllMocks())

  it('stays paused when paused before it came, and plays on the next tap', async () => {
    const { result } = await renderHook(() =>
      useListen(undefined, { importCoverTone: () => Promise.reject(new Error('none')) }),
    )
    await act(async () => result.current.toggle(TRACK))
    expect(result.current.listening?.status).toBe('loading')

    // Paused while the download is on its way.
    await act(async () => result.current.toggle(TRACK))
    expect(result.current.listening?.status).toBe('paused')

    await act(async () => mockArrive('blob:own'))
    expect(mockAudio.play).not.toHaveBeenCalled()

    await act(async () => result.current.toggle(TRACK))
    expect(mockAudio.play).toHaveBeenCalledWith('blob:own')
  })

  it('plays as it comes when nobody paused it', async () => {
    const { result } = await renderHook(() =>
      useListen(undefined, { importCoverTone: () => Promise.reject(new Error('none')) }),
    )
    await act(async () => result.current.toggle(TRACK))
    await act(async () => mockArrive('blob:own'))
    expect(mockAudio.play).toHaveBeenCalledWith('blob:own')
  })
})
