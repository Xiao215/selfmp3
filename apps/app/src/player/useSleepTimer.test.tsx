import { act, renderHook } from '@testing-library/react-native'
import type { EngineState, PlaybackEngine } from '@selfmp3/client'

import { useSleepTimer } from './useSleepTimer'

/*
 * The sleep timer over a stand-in engine that keeps a level, a mute and
 * play/pause: the engine is the outermost boundary, and these are all the
 * timer touches of it.
 */
function fakeEngine(start: Partial<EngineState> = {}) {
  let state: EngineState = {
    playing: true,
    currentTime: 0,
    duration: 0,
    volume: 0.8,
    muted: false,
    stalled: false,
    error: null,
    ...start,
  }
  const engine = {
    get state() {
      return state
    },
    setVolume: jest.fn((volume: number) => {
      state = { ...state, volume, muted: volume === 0 ? state.muted : false }
    }),
    pause: jest.fn(() => {
      state = { ...state, playing: false }
    }),
  }
  return engine as typeof engine & PlaybackEngine
}

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

describe('the sleep timer', () => {
  it('stops the music at its level, and is no longer set once it has', async () => {
    const engine = fakeEngine()
    const { result } = await renderHook(() => useSleepTimer(engine))
    await act(() => result.current.set(1))
    expect(result.current.endsAt).not.toBeNull()

    await act(() => jest.advanceTimersByTime(60_000 + 5_000))
    expect(engine.pause).toHaveBeenCalled()
    expect(engine.state.volume).toBe(0.8)
    expect(result.current.endsAt).toBeNull()
  })

  it('puts the level back when called off part-way through the fade', async () => {
    const engine = fakeEngine()
    const { result } = await renderHook(() => useSleepTimer(engine))
    await act(() => result.current.set(1))
    await act(() => jest.advanceTimersByTime(60_000 + 2_000))
    expect(engine.state.volume).toBeLessThan(0.8)

    await act(() => result.current.set(null))
    expect(engine.state.volume).toBe(0.8)
    await act(() => jest.advanceTimersByTime(5_000))
    expect(engine.pause).not.toHaveBeenCalled()
  })

  it('leaves a muted player muted', async () => {
    const engine = fakeEngine({ muted: true })
    const { result } = await renderHook(() => useSleepTimer(engine))
    await act(() => result.current.set(1))
    await act(() => jest.advanceTimersByTime(60_000 + 5_000))
    expect(engine.pause).toHaveBeenCalled()
    expect(engine.state.muted).toBe(true)
    expect(result.current.endsAt).toBeNull()
  })
})
