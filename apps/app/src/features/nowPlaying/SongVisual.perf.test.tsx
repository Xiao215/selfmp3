import type { ReactElement } from 'react'
import { act, render } from '@testing-library/react-native'
import { Animated } from 'react-native'
import type { Song } from '@selfmp3/shared'
import { SongVisual } from './SongVisual'
import { beatSampler } from './motionSource.model'
import { HILL_LAYERS, hillPoints, MAX_RINGS } from './visualMotion.model'
import { VISUAL_KINDS, visualFeel } from './visuals.model'

/** Whether the player says it is playing: a test flips it and renders again. */
let mockPlaying = true

jest.mock('../../player/PlayerProvider', () => ({
  usePlayer: () => ({
    isPlaying: mockPlaying,
    getPosition: () => 12,
    subscribeProgress: () => () => undefined,
  }),
  usePracticeState: () => ({
    loopA: null,
    loopB: null,
    countingIn: false,
    rate: 1,
    preservesPitch: true,
  }),
}))

// Every write to a shared value's `.value`: what crosses to the UI thread.
let mockSharedWrites = 0
/** Each array written, in order: the frames the styles read on the UI thread. */
const mockWrites: number[][] = []
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
          if (property === 'value') {
            mockSharedWrites++
            if (Array.isArray(value)) mockWrites.push(value as number[])
          }
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
  audioFeatures: { bpm: 120, energy: 0.8, loudness: -8, camelot: '8A' },
} as unknown as Song

async function frames(n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      jest.advanceTimersByTime(16)
    })
  }
}

/** Renders and gives it a size, which is what starts the loop. */
async function laidOut(element: ReactElement) {
  const view = await render(element)
  const box = view.container.queryAll(node => typeof node.props['onLayout'] === 'function')[0]!
  await act(async () => {
    box.props['onLayout']({ nativeEvent: { layout: { width: 390, height: 500 } } })
  })
  return view
}

/** The last frame written (the ring widths travel apart, and are shorter). */
function lastFrame(): number[] {
  return mockWrites.filter(written => written.length > MAX_RINGS).at(-1)!
}

/**
 * The hill points in a frame: how far each point of each line sits below its
 * peak. They are the tail of the frame, a line's travel followed by its points,
 * and the travel is left out here because a frame of play moves it a little.
 */
function hillsOf(frame: number[]): number[] {
  const span = HILL_LAYERS.reduce((total, layer) => total + 1 + hillPoints(layer.gaps), 0)
  const region = frame.slice(frame.length - span)
  const points: number[] = []
  let at = 0
  for (const layer of HILL_LAYERS) {
    const count = hillPoints(layer.gaps)
    points.push(...region.slice(at + 1, at + 1 + count))
    at += 1 + count
  }
  return points
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
    mockPlaying = true
    mockWrites.length = 0
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  for (const kind of VISUAL_KINDS) {
    it(`${kind}: one shared-value write a frame, no Animated.Value at all`, async () => {
      const sampler = beatSampler(visualFeel(song.audioFeatures))
      const setValue = jest.spyOn(Animated.Value.prototype, 'setValue')
      await laidOut(<SongVisual song={song} kind={kind} sampler={sampler} />)
      await frames(5)
      setValue.mockClear()
      mockSharedWrites = 0
      const raf = jest.spyOn(globalThis, 'requestAnimationFrame')
      await frames(60)
      const ticks = raf.mock.calls.length
      expect(ticks).toBeGreaterThan(0)
      expect(setValue).not.toHaveBeenCalled()
      // The frame, and for Ripples a ring's width when a new ring leaves the
      // centre — a few times a second, never once a frame.
      expect(mockSharedWrites / ticks).toBeGreaterThanOrEqual(1)
      expect(mockSharedWrites / ticks).toBeLessThan(1.1)
      setValue.mockRestore()
      raf.mockRestore()
    })
  }

  it('keeps the hills it has heard across a pause', async () => {
    // The bug this holds off: the motion state used to be made inside the loop's
    // effect, which runs again when the play state changes, so pause and play
    // threw away three trails of what the song had sounded like so far and the
    // horizon jumped back to the landscape a song starts with.
    const sampler = beatSampler(visualFeel(song.audioFeatures))
    const view = await laidOut(<SongVisual song={song} kind="horizon" sampler={sampler} />)
    await frames(1)
    const seeded = hillsOf(lastFrame())
    // Long enough for the quick trail to fill with what it heard.
    await frames(220)
    const heard = hillsOf(lastFrame())
    expect(heard).not.toEqual(seeded)

    mockPlaying = false
    await view.rerender(<SongVisual song={song} kind="horizon" sampler={sampler} />)
    await frames(400)
    mockPlaying = true
    mockWrites.length = 0
    await view.rerender(<SongVisual song={song} kind="horizon" sampler={sampler} />)
    await frames(1)
    // One frame of play cannot fill a slot, so every point stands where it did.
    expect(hillsOf(lastFrame())).toEqual(heard)
  })

  it('writes nothing once a paused visual has settled', async () => {
    const sampler = beatSampler(visualFeel(song.audioFeatures))
    await laidOut(<SongVisual song={song} kind="ripples" sampler={sampler} />)
    // Never told it is playing here: `isPlaying` is true in the mock, so pause
    // it by making the sampler silent instead — the motion settles the same way.
    sampler.sample = () => ({ level: 0, onset: 0 })
    await frames(400)
    mockSharedWrites = 0
    await frames(60)
    expect(mockSharedWrites).toBe(0)
  })
})
