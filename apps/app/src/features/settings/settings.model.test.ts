import { describe, expect, it } from 'vitest'
import { ApiError } from '@selfmp3/client'

import {
  crossfadeLabel,
  CROSSFADE_STEPS,
  devicePlace,
  downloadHint,
  healthLine,
  nearestStep,
  onThisDevice,
  RECENT_DEVICE_WINDOW_MS,
  scanHint,
  splitDevices,
} from './settings.model'

describe('settings', () => {
  it('names what this device keeps for the device it is', () => {
    expect(onThisDevice(devicePlace('phone', true))).toBe('On this phone')
    expect(onThisDevice(devicePlace('desktop', true))).toBe('On this computer')
    expect(devicePlace('phone', true, true)).toBe('iPad')
    expect(devicePlace('phone', false, true)).toBe('browser')
    expect(devicePlace('other', true)).toBe('computer')
    // A tab keeps what it has in the browser, not on the device it runs on.
    expect(devicePlace('desktop', false)).toBe('browser')
    expect(devicePlace('phone', false)).toBe('browser')
  })

  it('tells a browser that cannot name its chip how to find out', () => {
    const base = { loading: false, error: false, version: '1.0.0', offers: 2 }
    expect(downloadHint({ ...base, chip: 'arm64' })).toMatch(/^Version 1\.0\.0\. /)
    expect(downloadHint({ ...base, chip: 'arm64' })).not.toContain('About This Mac')
    expect(downloadHint({ ...base, chip: null })).toContain('About This Mac')
    expect(downloadHint({ ...base, offers: 0, chip: null })).toBe('No release yet.')
    expect(downloadHint({ ...base, loading: true, chip: null })).toBe('Finding the latest version…')
    expect(downloadHint({ ...base, error: true, chip: null })).toContain('releases page')
  })

  it('shows a crossfade kept from the slider as the nearest step (C4a)', () => {
    expect(CROSSFADE_STEPS[0]).toBe(0)
    expect(nearestStep(0)).toBe(0)
    expect(nearestStep(4)).toBe(4)
    expect(nearestStep(3)).toBe(2)
    expect(nearestStep(8)).toBe(6)
    expect(nearestStep(12)).toBe(10)
  })

  it('words the rows', () => {
    expect(crossfadeLabel(0)).toBe('Off')
    expect(crossfadeLabel(4)).toBe('4s')
  })

  it('says nothing while it checks, and which side it could not reach', () => {
    expect(healthLine(undefined, { loading: true })).toBeNull()
    expect(healthLine(undefined, { error: true })).toBe('Can’t reach your library')
    const capped = new ApiError(502, 'cap exceeded', 'bucket_cap_exceeded')
    const now = new Date('2026-10-08T04:00:00Z')
    expect(healthLine(undefined, { error: capped, now })).toBe(
      'Storage allowance used up · resets in about 20 hours',
    )
  })

  it('says the bucket is refusing over a doorman that answered, shorter on a phone', () => {
    const doorman = { ok: true as const, version: 'web', uptimeSeconds: 0 }
    const now = new Date('2026-10-08T04:00:00Z')
    expect(healthLine(doorman, {})).toBeNull()
    expect(healthLine(doorman, { capped: true, now })).toBe(
      'Storage allowance used up · resets in about 20 hours',
    )
    expect(healthLine(doorman, { capped: true, compact: true, now })).toBe(
      'Storage allowance used up · 20 h left',
    )
  })

  it('keeps this device, what is online and the last week, and folds the rest away', () => {
    const now = 100 * RECENT_DEVICE_WINDOW_MS
    const row = (id: string, ageMs: number, online = false, copies: string[] = []) => ({
      device: { id, online, lastSeenAt: now - ageMs },
      ids: [id, ...copies],
    })
    const rows = [
      row('me', 30 * RECENT_DEVICE_WINDOW_MS),
      row('phone', 0, true),
      // The newest of a name's folded copies is a device in use; the rest are stale.
      row('mac', RECENT_DEVICE_WINDOW_MS - 1, false, ['mac-2', 'mac-3']),
      row('old', RECENT_DEVICE_WINDOW_MS + 1, false, ['old-2']),
    ]
    const { recent, olderIds } = splitDevices(rows, 'me', now)
    expect(recent.map(entry => entry.device.id)).toEqual(['me', 'phone', 'mac'])
    expect(recent.find(entry => entry.device.id === 'mac')?.ids).toEqual(['mac'])
    expect(olderIds).toEqual(['mac-2', 'mac-3', 'old', 'old-2'])
  })

  it('says nothing over a library that answered, only when it is not connected', () => {
    expect(healthLine(undefined)).toBe('Not connected to your library right now')
    expect(
      healthLine({
        ok: true,
        version: '1.0.0',
        uptimeSeconds: 5,
        songCount: 13,
      }),
    ).toBeNull()
    expect(scanHint({ added: 1, updated: 2, total: 13, durationMs: 40 })).toBe(
      'Last scan: 1 new, 2 updated.',
    )
  })
})
