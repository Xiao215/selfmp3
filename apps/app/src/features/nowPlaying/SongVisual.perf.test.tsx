import { act, render } from '@testing-library/react-native'
import { Animated } from 'react-native'
import type { Song } from '@selfmp3/shared'
import { SongVisual } from './SongVisual'
import { beatSampler } from './motionSource'
import { visualFeel } from './visuals.model'
import type { VisualKind } from './visuals.model'

jest.mock('../../player/PlayerProvider', () => ({
  usePlayer: () => ({
    isPlaying: true,
    rate: 1,
    getPosition: () => 12,
    subscribeProgress: () => () => undefined,
  }),
}))

// Every write to a shared value's `.value`: what crosses to the UI thread.
let mockSharedWrites = 0
jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual('react-native-reanimated')
  return {
    __esModule: true,
    ...actual,
    default: actual.default,
    useSharedValue: (initial: unknown) => {
      const shared = actual.useSharedValue(initial)
      return new Proxy(shared, {
        set(target, property, value) {
          if (property === 'value') mockSharedWrites++
          return Reflect.set(target, property, value)
        },
      })
    },
  }
})

const song = {
  id: 7,
  title: 'A',
  artist: 'B',
  album: 'C',
  audioFeatures: { bpm: 120, energy: 0.8, danceability: 0.7, loudness: -8, camelot: '8A' },
} as unknown as Song

async function frames(n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      jest.advanceTimersByTime(16)
    })
  }
}

/**
 * What one frame of a visual costs the phone, counted rather than timed: on
 * the New Architecture every `Animated.Value.setValue` is a `setNativeProps`,
 * and every one of those is a commit of the whole shadow tree, on the
 * JavaScript thread. A frame should cross to the UI thread once, whatever it
 * moves.
 */
describe('SongVisual (native) per-frame cost', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  for (const kind of ['aurora', 'pulse', 'spectrum', 'drift'] as VisualKind[]) {
    it(`${kind}: one shared-value write a frame, no Animated.Value at all`, async () => {
      const sampler = beatSampler(visualFeel(song.audioFeatures))
      const setValue = jest.spyOn(Animated.Value.prototype, 'setValue')
      const { container } = await render(<SongVisual song={song} kind={kind} sampler={sampler} />)
      // Lay it out, so the loop starts.
      const view = container.queryAll(node => typeof node.props['onLayout'] === 'function')[0]!
      await act(async () => {
        view.props['onLayout']({ nativeEvent: { layout: { width: 390, height: 500 } } })
      })
      await frames(5)
      setValue.mockClear()
      mockSharedWrites = 0
      const raf = jest.spyOn(globalThis, 'requestAnimationFrame')
      await frames(60)
      const ticks = raf.mock.calls.length
      expect(ticks).toBeGreaterThan(0)
      expect(setValue).not.toHaveBeenCalled()
      // The frame, and for Pulse a ring's width when a new ring leaves the
      // centre — a few times a second, never once a frame.
      expect(mockSharedWrites / ticks).toBeGreaterThanOrEqual(1)
      expect(mockSharedWrites / ticks).toBeLessThan(1.1)
      setValue.mockRestore()
      raf.mockRestore()
    })
  }

  it('writes nothing once a paused visual has settled', async () => {
    const sampler = beatSampler(visualFeel(song.audioFeatures))
    const { container } = await render(<SongVisual song={song} kind="pulse" sampler={sampler} />)
    const view = container.queryAll(node => typeof node.props['onLayout'] === 'function')[0]!
    await act(async () => {
      view.props['onLayout']({ nativeEvent: { layout: { width: 390, height: 500 } } })
    })
    // Never told it is playing here: `isPlaying` is true in the mock, so pause
    // it by making the sampler silent instead — the motion settles the same way.
    sampler.sample = () => ({ level: 0, onset: 0 })
    await frames(400)
    mockSharedWrites = 0
    await frames(60)
    expect(mockSharedWrites).toBe(0)
  })
})
