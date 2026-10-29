import { describe, expect, it } from 'vitest'

import {
  SLOT_LEASE_MS,
  chooseSlot,
  parseLeases,
  releaseLease,
  renewLease,
  slotDeviceId,
  slotDeviceName,
} from './tabSlots.model'

const NOW = 1_800_000_000_000

describe('which device a browser tab is', () => {
  it('gives the first tab the browser’s own id, and a second tab the next slot', () => {
    const first = chooseSlot({}, { remembered: null, tab: 'a', now: NOW })
    expect(first).toBe(0)
    const leases = renewLease({}, { slot: first, tab: 'a', now: NOW })
    expect(chooseSlot(leases, { remembered: null, tab: 'b', now: NOW })).toBe(1)
    expect(slotDeviceId('base-id', 0)).toBe('base-id')
    expect(slotDeviceId('base-id', 1)).toBe('base-id-2')
    expect(slotDeviceName('Mac · Chrome', 1)).toBe('Mac · Chrome · tab 2')
  })

  it('keeps a reloaded tab on its slot once the old page handed it back', () => {
    let leases = renewLease({}, { slot: 0, tab: 'a', now: NOW })
    leases = renewLease(leases, { slot: 1, tab: 'b', now: NOW })
    leases = releaseLease(leases, { slot: 1, tab: 'b' })
    expect(chooseSlot(leases, { remembered: 1, tab: 'b-reloaded', now: NOW })).toBe(1)
  })

  it('moves a duplicated tab off the slot its live original holds', () => {
    const leases = renewLease({}, { slot: 0, tab: 'a', now: NOW })
    expect(chooseSlot(leases, { remembered: 0, tab: 'copy', now: NOW + 1_000 })).toBe(1)
  })

  it('frees a slot whose tab died without handing it back, once its lease runs out', () => {
    const leases = renewLease({}, { slot: 0, tab: 'crashed', now: NOW })
    expect(chooseSlot(leases, { remembered: null, tab: 'b', now: NOW + 1_000 })).toBe(1)
    expect(chooseSlot(leases, { remembered: null, tab: 'b', now: NOW + SLOT_LEASE_MS + 1 })).toBe(0)
    // Renewing drops expired leases from what is stored.
    const renewed = renewLease(leases, { slot: 1, tab: 'b', now: NOW + SLOT_LEASE_MS + 1 })
    expect(Object.keys(renewed)).toEqual(['1'])
  })

  it('never hands back a slot another tab has taken since', () => {
    const leases = renewLease({}, { slot: 0, tab: 'new', now: NOW })
    expect(releaseLease(leases, { slot: 0, tab: 'old' })).toBe(leases)
  })

  it('reads whatever is stored without throwing', () => {
    expect(parseLeases(null)).toEqual({})
    expect(parseLeases('{nope')).toEqual({})
    expect(parseLeases('{"0":{"tab":"a","at":1},"x":{"tab":"b","at":2},"1":{"tab":3}}')).toEqual({
      '0': { tab: 'a', at: 1 },
    })
  })
})
