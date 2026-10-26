import { describe, expect, it } from 'vitest'
import type { PlaybackState } from '@selfmp3/shared'
import {
  deviceLabels,
  handoffTarget,
  heardAt,
  serverTime,
  shortDeviceName,
  type ListHeard,
} from './handoff.js'

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

/** Heard just now, from a server whose clock agrees with this device's. */
const HEARD: ListHeard = { serverNow: NOW, receivedAt: NOW }

/** A device whose heartbeat the server received at NOW. */
function device(patch: Partial<PlaybackState> = {}) {
  return { state: state(patch), lastSeenAt: NOW }
}

describe('handoffTarget', () => {
  it('keeps the queue and locates the song inside it', () => {
    expect(handoffTarget(device(), HEARD, NOW)).toEqual({
      queueIds: [1, 2, 3],
      index: 1,
      position: 40,
    })
  })

  it('trusts songId over a stale queueIndex', () => {
    expect(handoffTarget(device({ queueIndex: 0 }), HEARD, NOW)?.index).toBe(1)
  })

  it('resumes a song queued twice at the copy that was playing', () => {
    expect(handoffTarget(device({ queueIds: [2, 1, 2], queueIndex: 2 }), HEARD, NOW)?.index).toBe(2)
  })

  it('plays the song alone when the queue does not contain it', () => {
    expect(handoffTarget(device({ queueIds: [7, 8] }), HEARD, NOW)).toEqual({
      queueIds: [2],
      index: 0,
      position: 40,
    })
  })

  it('advances the position of a state that is still playing', () => {
    expect(handoffTarget(device({ playing: true }), HEARD, NOW + 6_000)?.position).toBeCloseTo(46)
  })

  it('has nothing to hand off when nothing was loaded', () => {
    expect(handoffTarget(device({ songId: null }), HEARD, NOW)).toBeNull()
  })
})

/*
 * Three clocks: the phone that sent the heartbeat, the server that stamped it,
 * and the laptop pressing "Play here". None of them agrees with another, and
 * the answer must not care. The story every case tells: the phone captured
 * 40 s into the song as it sent its heartbeat, the server answered a list 3 s
 * after receiving it, and the laptop presses "Play here" 2 s after that list
 * arrived — so the song is 45 s in.
 */
describe('handoffTarget with clocks that disagree', () => {
  const SERVER = 1_800_000_000_000

  function pressed(skews: { readonly phone: number; readonly laptop: number }) {
    const sent = state({ position: 40, playing: true, updatedAt: SERVER + skews.phone })
    const listArrived = SERVER + 3_000 + skews.laptop
    const heard = { serverNow: SERVER + 3_000, receivedAt: listArrived }
    return handoffTarget({ state: sent, lastSeenAt: SERVER }, heard, listArrived + 2_000)?.position
  }

  it('is right when every clock agrees', () => {
    expect(pressed({ phone: 0, laptop: 0 })).toBeCloseTo(45)
  })

  it('ignores the sending phone running minutes fast or slow', () => {
    expect(pressed({ phone: 5 * 60_000, laptop: 0 })).toBeCloseTo(45)
    expect(pressed({ phone: -5 * 60_000, laptop: 0 })).toBeCloseTo(45)
  })

  it('ignores the laptop pressing it running fast or slow', () => {
    expect(pressed({ phone: 0, laptop: 90_000 })).toBeCloseTo(45)
    expect(pressed({ phone: 0, laptop: -90_000 })).toBeCloseTo(45)
  })

  it('ignores both at once, in either direction', () => {
    expect(pressed({ phone: 7_000, laptop: -11_000 })).toBeCloseTo(45)
    expect(pressed({ phone: -7_000, laptop: 11_000 })).toBeCloseTo(45)
  })

  /*
   * The bug: the laptop's clock minus the phone's `updatedAt`. With the phone
   * 7 s slow that measured 12 s where 5 had passed, and with it 7 s fast it
   * measured nothing at all and started where the last heartbeat said.
   */
  it('does not measure from the sending device’s own stamp', () => {
    const slowPhone = state({ position: 40, playing: true, updatedAt: SERVER - 7_000 })
    const heard = { serverNow: SERVER + 3_000, receivedAt: SERVER + 3_000 }
    const target = handoffTarget({ state: slowPhone, lastSeenAt: SERVER }, heard, SERVER + 5_000)
    expect(target?.position).toBeCloseTo(45)
  })

  it('leaves a paused device where it stopped, whatever the clocks', () => {
    const paused = state({ position: 40, updatedAt: SERVER - 60_000 })
    const heard = { serverNow: SERVER + 3_000, receivedAt: SERVER + 90_000 }
    expect(
      handoffTarget({ state: paused, lastSeenAt: SERVER }, heard, SERVER + 95_000)?.position,
    ).toBe(40)
  })
})

describe('heardAt and serverTime', () => {
  const heard = { serverNow: 10_000, receivedAt: 500_000 }

  it('moves a server time onto this device’s clock and back', () => {
    expect(heardAt(7_000, heard)).toBe(497_000)
    expect(serverTime(heard, 497_000)).toBe(7_000)
  })

  it('never puts a heartbeat after the list that carried it', () => {
    // On one clock a lastSeenAt past the list's own `now` cannot happen; a row
    // that says so anyway counts as heard with the list.
    expect(heardAt(12_000, heard)).toBe(500_000)
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

describe('deviceLabels', () => {
  const labels = (devices: { id: string; name: string }[]): string[] => {
    const named = deviceLabels(devices)
    return devices.map(device => named.get(device.id) ?? '')
  }

  it('shortens names nothing else on the list shares', () => {
    expect(
      labels([
        { id: 'a', name: 'Mac · Chrome' },
        { id: 'b', name: 'iPhone · Safari' },
        { id: 'c', name: 'Kitchen' },
      ]),
    ).toEqual(['Mac', 'iPhone', 'Kitchen'])
  })

  it('keeps the browser and the tab where the short names would be the same (R3-m2)', () => {
    expect(
      labels([
        { id: 'a', name: 'Mac · Chrome' },
        { id: 'a-2', name: 'Mac · Chrome · tab 2' },
        { id: 'b', name: 'Mac · Safari' },
        { id: 'c', name: 'iPhone · Safari' },
      ]),
    ).toEqual(['Mac · Chrome', 'Mac · Chrome · tab 2', 'Mac · Safari', 'iPhone'])
  })

  it('numbers the same name on two devices, the same way on every device', () => {
    const one = { id: 'b-mac', name: 'Mac · Chrome' }
    const two = { id: 'a-mac', name: 'Mac · Chrome' }
    expect(labels([one, two])).toEqual(['Mac · Chrome 2', 'Mac · Chrome'])
    expect(labels([two, one])).toEqual(['Mac · Chrome', 'Mac · Chrome 2'])
  })
})
