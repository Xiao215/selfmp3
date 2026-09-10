import { describe, expect, it } from 'vitest'
import type { PlaybackState } from '@selfmp3/shared'
import { handoffTarget, shortDeviceName } from './handoff.js'

const NOW = 1_800_000_000_000

function state(patch: Partial<PlaybackState> = {}): PlaybackState {
  return {
    songId: 2,
    position: 40,
    playing: false,
    queueIds: [1, 2, 3],
    queueIndex: 1,
    shuffle: false,
    repeat: 'off',
    updatedAt: NOW,
    ...patch,
  }
}

describe('handoffTarget', () => {
  it('keeps the queue and locates the song inside it', () => {
    expect(handoffTarget(state(), NOW)).toEqual({ queueIds: [1, 2, 3], index: 1, position: 40 })
  })

  it('trusts songId over a stale queueIndex', () => {
    expect(handoffTarget(state({ queueIndex: 0 }), NOW)?.index).toBe(1)
  })

  it('plays the song alone when the queue does not contain it', () => {
    expect(handoffTarget(state({ queueIds: [7, 8] }), NOW)).toEqual({
      queueIds: [2],
      index: 0,
      position: 40,
    })
  })

  it('advances the position of a state that is still playing', () => {
    expect(handoffTarget(state({ playing: true }), NOW + 6_000)?.position).toBeCloseTo(46)
  })

  it('has nothing to hand off when nothing was loaded', () => {
    expect(handoffTarget(state({ songId: null }), NOW)).toBeNull()
  })
})

describe('shortDeviceName', () => {
  it('drops the browser half', () => {
    expect(shortDeviceName('iPhone · Safari')).toBe('iPhone')
    expect(shortDeviceName('Mac · Chrome')).toBe('Mac')
  })

  it('leaves a custom name alone', () => {
    expect(shortDeviceName('Kitchen speaker')).toBe('Kitchen speaker')
  })
})
