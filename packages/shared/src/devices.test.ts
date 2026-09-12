import { describe, expect, it } from 'vitest'
import {
  extrapolatePosition,
  isDeviceOnline,
  pickResumeState,
  playbackStateChanged,
} from './devices.js'
import {
  DeviceCommandSchema,
  DeviceHeartbeatSchema,
  type Device,
  type PlaybackState,
} from './schemas/devices.js'

const NOW = 1_800_000_000_000

function state(patch: Partial<PlaybackState> = {}): PlaybackState {
  return {
    songId: 1,
    position: 30,
    playing: false,
    queueIds: [1, 2, 3],
    queueIndex: 0,
    shuffle: false,
    repeat: 'off',
    updatedAt: NOW,
    ...patch,
  }
}

function device(
  id: string,
  patch: Partial<Device> = {},
  statePatch: Partial<PlaybackState> = {},
): Device {
  return {
    id,
    name: id,
    kind: 'desktop',
    state: state(statePatch),
    lastSeenAt: NOW,
    online: true,
    ...patch,
  }
}

describe('isDeviceOnline', () => {
  it('is online inside the window and offline after it', () => {
    expect(isDeviceOnline(NOW - 29_000, NOW)).toBe(true)
    expect(isDeviceOnline(NOW - 30_000, NOW)).toBe(true)
    expect(isDeviceOnline(NOW - 30_001, NOW)).toBe(false)
  })

  it('treats a heartbeat from the future as fresh', () => {
    expect(isDeviceOnline(NOW + 5_000, NOW)).toBe(true)
  })
})

describe('pickResumeState', () => {
  it('skips this device and devices with nothing loaded', () => {
    const picked = pickResumeState(
      [
        device('me'),
        device('empty', {}, { songId: null }),
        device('phone', { lastSeenAt: NOW - 60_000 }),
      ],
      { thisDeviceId: 'me', now: NOW },
    )
    expect(picked?.id).toBe('phone')
  })

  it('prefers a playing device over a fresher paused one', () => {
    const picked = pickResumeState(
      [
        device('paused', { lastSeenAt: NOW - 1_000 }),
        device('playing', { lastSeenAt: NOW - 3_600_000 }, { playing: true }),
      ],
      { thisDeviceId: 'me', now: NOW },
    )
    expect(picked?.id).toBe('playing')
  })

  it('picks the most recently seen among equals', () => {
    const picked = pickResumeState(
      [device('old', { lastSeenAt: NOW - 5_000 }), device('new', { lastSeenAt: NOW - 1_000 })],
      { thisDeviceId: 'me', now: NOW },
    )
    expect(picked?.id).toBe('new')
  })

  it('ignores anything older than the age limit', () => {
    const picked = pickResumeState([device('stale', { lastSeenAt: NOW - 25 * 3_600_000 })], {
      thisDeviceId: 'me',
      now: NOW,
    })
    expect(picked).toBeNull()
  })
})

describe('extrapolatePosition', () => {
  it('advances a playing state by the elapsed time and clamps to duration', () => {
    expect(extrapolatePosition(state({ playing: true }), NOW + 4_000)).toBeCloseTo(34)
    expect(extrapolatePosition(state({ playing: true }), NOW + 400_000, 200)).toBe(200)
  })

  it('leaves a paused state alone', () => {
    expect(extrapolatePosition(state(), NOW + 4_000)).toBe(30)
  })

  /*
   * `updatedAt` is the sending device's clock and a reader's `now` is its own.
   * The two being a few seconds apart is ordinary, and subtracting one from
   * the other put the scrubber wherever that difference happened to be — stuck
   * at the last heartbeat when the sender ran fast, jumped forward when slow.
   */
  it('measures from when the reader heard it, when the reader says so', () => {
    const playing = state({ playing: true })

    // A reader whose clock is two minutes ahead of the sender's.
    const heard = NOW + 120_000
    expect(extrapolatePosition(playing, heard + 4_000, undefined, heard)).toBeCloseTo(34)

    // And one whose clock is behind it, which used to freeze the scrubber.
    const behind = NOW - 120_000
    expect(extrapolatePosition(playing, behind + 4_000, undefined, behind)).toBeCloseTo(34)
  })
})

describe('playbackStateChanged', () => {
  it('ignores normal progress but notices a seek', () => {
    const before = state({ playing: true })
    expect(
      playbackStateChanged(before, state({ playing: true, position: 35, updatedAt: NOW + 5_000 })),
    ).toBe(false)
    expect(
      playbackStateChanged(before, state({ playing: true, position: 90, updatedAt: NOW + 5_000 })),
    ).toBe(true)
  })

  it('stays quiet while a paused state simply sits there', () => {
    const before = state({ playing: false })
    expect(playbackStateChanged(before, state({ playing: false, updatedAt: NOW + 60_000 }))).toBe(
      false,
    )
  })

  it('notices play/pause and track changes', () => {
    expect(playbackStateChanged(state(), state({ playing: true }))).toBe(true)
    expect(playbackStateChanged(state(), state({ songId: 2 }))).toBe(true)
    expect(playbackStateChanged(null, state())).toBe(true)
  })
})

describe('schemas', () => {
  it('accepts a well-formed heartbeat and rejects a bad device id', () => {
    const good = DeviceHeartbeatSchema.safeParse({
      deviceId: 'abcdefgh-1234',
      name: 'iPhone · Safari',
      kind: 'phone',
      state: state(),
    })
    expect(good.success).toBe(true)

    const bad = DeviceHeartbeatSchema.safeParse({
      deviceId: 'no spaces allowed',
      name: 'x',
      kind: 'phone',
      state: state(),
    })
    expect(bad.success).toBe(false)
  })

  it('validates commands as a discriminated union', () => {
    expect(DeviceCommandSchema.safeParse({ type: 'pause' }).success).toBe(true)
    expect(DeviceCommandSchema.safeParse({ type: 'seek', position: 12.5 }).success).toBe(true)
    expect(DeviceCommandSchema.safeParse({ type: 'seek' }).success).toBe(false)
    expect(DeviceCommandSchema.safeParse({ type: 'setVolume', volume: 2 }).success).toBe(false)
    expect(
      DeviceCommandSchema.safeParse({
        type: 'playSong',
        songId: 3,
        queueIds: [3, 4],
        queueIndex: 0,
      }).success,
    ).toBe(true)
    expect(
      DeviceCommandSchema.safeParse({ type: 'transfer', fromDeviceId: 'abcdefghij' }).success,
    ).toBe(true)
    expect(DeviceCommandSchema.safeParse({ type: 'dance' }).success).toBe(false)
  })
})
