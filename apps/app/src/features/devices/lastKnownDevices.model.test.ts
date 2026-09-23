import { describe, expect, it } from 'vitest'

import { knownAsDevices, parseKnownDevices, serializeKnownDevices } from './lastKnownDevices.model'

const device = (id: string, name: string, lastSeenAt: number, online = true) =>
  ({ id, name, kind: 'desktop', lastSeenAt, online, state: { songId: 3 } }) as never

describe('the last known devices', () => {
  it('keeps what a row draws, and nothing about what was playing', () => {
    // Ids are the shared device shape's, so a row is read back through it.
    const raw = serializeKnownDevices([device('mac-aaaa1111', 'Mac · Chrome', 100)], 500)
    expect(raw).not.toContain('songId')
    expect(parseKnownDevices(raw)).toEqual({
      savedAt: 500,
      devices: [{ id: 'mac-aaaa1111', name: 'Mac · Chrome', kind: 'desktop', lastSeenAt: 100 }],
    })
  })

  it('reads anything else as no list', () => {
    expect(parseKnownDevices(null)).toBeNull()
    expect(parseKnownDevices('')).toBeNull()
    expect(parseKnownDevices('not json')).toBeNull()
    expect(parseKnownDevices('{"savedAt":1,"devices":[]}')).toBeNull()
    expect(parseKnownDevices('{"devices":[{"id":"a","name":"x","lastSeenAt":1}]}')).toBeNull()
    expect(parseKnownDevices('{"savedAt":1,"devices":[{"id":2}]}')).toBeNull()
  })

  it('draws every kept row as offline', () => {
    const [row] = knownAsDevices([{ id: 'a', name: 'iPhone', kind: 'phone', lastSeenAt: 9 }])
    expect(row).toMatchObject({ id: 'a', online: false, lastSeenAt: 9 })
    expect(row?.state.playing).toBe(false)
  })
})
