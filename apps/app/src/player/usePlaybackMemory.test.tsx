import { renderHook } from '@testing-library/react-native'
import { EMPTY_QUEUE, type QueueState } from '@selfmp3/shared'
import type { PlayBlock } from '@selfmp3/client'
import { usePlaybackMemory } from './usePlaybackMemory'
import { POSITION_KEY, SESSION_KEY } from './session.model'

/*
 * Opening the web app offline lost the song for good (R4 web-cloud m1b): the
 * saved song could not load, coming back counted as done anyway, and the next
 * refresh wrote the empty queue over what was saved. These run the real hook
 * over a player and a device that are only what it reads of them.
 */

const mockPrefs = new Map<string, string>()
jest.mock('../ports/prefs', () => ({
  prefs: {
    get: (key: string) => mockPrefs.get(key) ?? null,
    set: (key: string, value: string) => mockPrefs.set(key, value),
  },
}))
jest.mock('expo-router', () => ({ useGlobalSearchParams: () => ({}) }))
jest.mock('@selfmp3/client', () => ({
  useLibrary: () => ({ data: { songs: [1, 2, 3].map(id => ({ id })) } }),
}))
jest.mock('../connection/ConnectionProvider', () => ({
  useConnection: () => ({ status: 'ready' }),
}))
/** Why a song cannot start here now: the same for every song. */
const mockDevice = { block: null as PlayBlock | null, streamBlocked: false }
jest.mock('../offline/DownloadsProvider', () => ({
  useDownloads: () => ({
    blockFor: () => mockDevice.block,
    streamBlocked: mockDevice.streamBlocked,
  }),
}))

/** The player, as far as the hook reads it: a new object each render, like the provider's. */
let mockQueue: QueueState = EMPTY_QUEUE
const mockPlayFrom = jest.fn((ids: readonly number[], index: number, _options?: object) => {
  mockQueue = { ...EMPTY_QUEUE, items: [...ids], original: [...ids], index }
})
jest.mock('./PlayerProvider', () => ({
  usePlayer: () => {
    const id = mockQueue.items[mockQueue.index]
    return {
      queue: mockQueue,
      current: id === undefined ? null : { id },
      isPlaying: false,
      source: null,
      getPosition: () => 12,
      playFrom: mockPlayFrom,
    }
  },
}))

const SAVED = JSON.stringify({ queueIds: [2, 3, 1], index: 1, position: 40, source: null })

beforeEach(() => {
  mockPrefs.clear()
  mockPrefs.set(SESSION_KEY, SAVED)
  mockQueue = EMPTY_QUEUE
  mockDevice.block = null
  mockDevice.streamBlocked = false
  mockPlayFrom.mockClear()
})

describe('coming back to what this device played', () => {
  it('loads the saved song paused where it was', async () => {
    await renderHook(() => usePlaybackMemory())
    expect(mockPlayFrom).toHaveBeenCalledWith(
      [2, 3, 1],
      1,
      expect.objectContaining({ position: 40 }),
    )
    expect(mockPlayFrom.mock.calls[0]?.[2]).toMatchObject({ autoplay: false, shuffle: false })
  })

  it('opened out of reach, waits without writing over it, and comes back once in reach', async () => {
    mockDevice.block = 'unreachable'
    mockDevice.streamBlocked = true
    const hook = await renderHook(() => usePlaybackMemory())
    await hook.rerender({})
    expect(mockPlayFrom).not.toHaveBeenCalled()
    expect(mockPrefs.get(SESSION_KEY)).toBe(SAVED)

    // The bucket answers again, with no reload.
    mockDevice.block = null
    mockDevice.streamBlocked = false
    await hook.rerender({})
    expect(mockPlayFrom).toHaveBeenCalledWith(
      [2, 3, 1],
      1,
      expect.objectContaining({ position: 40 }),
    )
  })

  it('leaves a song that needs a question unloaded, and still saved for the next open', async () => {
    mockDevice.block = 'data'
    const hook = await renderHook(() => usePlaybackMemory())
    mockDevice.block = null
    mockDevice.streamBlocked = true
    await hook.rerender({})
    mockDevice.streamBlocked = false
    await hook.rerender({})
    expect(mockPlayFrom).not.toHaveBeenCalled()
    expect(mockPrefs.get(SESSION_KEY)).toBe(SAVED)
  })

  it('writes down a song played while it waited, which is this launch’s own', async () => {
    mockDevice.block = 'offline'
    const hook = await renderHook(() => usePlaybackMemory())
    mockQueue = { ...EMPTY_QUEUE, items: [1], original: [1], index: 0 }
    await hook.rerender({})
    expect(JSON.parse(mockPrefs.get(SESSION_KEY) ?? 'null')).toMatchObject({ queueIds: [1] })
    expect(JSON.parse(mockPrefs.get(POSITION_KEY) ?? 'null')).toEqual({ songId: 1, position: 12 })

    // Decided: in reach again, the old session does not come back over it.
    mockDevice.block = null
    mockDevice.streamBlocked = true
    await hook.rerender({})
    expect(mockPlayFrom).not.toHaveBeenCalled()
  })
})
