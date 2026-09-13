import { describe, expect, it } from 'vitest'
import type { Device } from '@selfmp3/shared'
import { deviceListView, RECENT_DEVICE_LIMIT } from './deviceList.js'

const NOW = 1_800_000_000_000
const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

function device(id: string, patch: Partial<Device> = {}): Device {
  return {
    id,
    name: 'Mac · Chrome',
    kind: 'desktop',
    online: false,
    lastSeenAt: NOW - 10 * MINUTE,
    state: {
      songId: null,
      position: 0,
      playing: false,
      queueIds: [],
      queueIndex: -1,
      shuffle: false,
      repeat: 'off',
      updatedAt: NOW,
    },
    ...patch,
  }
}

const ids = (groups: readonly { ids: readonly string[] }[]): string[][] =>
  groups.map(group => [...group.ids])

describe('deviceListView', () => {
  it('folds offline devices that share a name into one row, led by the one seen last', () => {
    const view = deviceListView(
      [
        device('old-000001', { lastSeenAt: NOW - 30 * MINUTE }),
        device('new-000001', { lastSeenAt: NOW - 5 * MINUTE }),
        device('pc-0000001', { name: 'Windows PC · Chrome' }),
      ],
      null,
      NOW,
    )
    expect(ids(view.recent)).toEqual([['new-000001', 'old-000001'], ['pc-0000001']])
    expect(view.recent[0]?.device.id).toBe('new-000001')
  })

  it('never folds this device or one online now, and puts them first', () => {
    const view = deviceListView(
      [
        device('offline-01', { lastSeenAt: NOW - MINUTE }),
        device('online-001', { online: true, lastSeenAt: NOW - 20 * MINUTE }),
        device('this-00001', { lastSeenAt: NOW - 2 * DAY }),
      ],
      'this-00001',
      NOW,
    )
    expect(ids(view.recent)).toEqual([['this-00001'], ['online-001'], ['offline-01']])
    expect(view.older).toEqual([])
  })

  it('shows what was seen in the last day, up to the limit, and keeps the rest for later', () => {
    const recentOnes = Array.from({ length: RECENT_DEVICE_LIMIT + 2 }, (_, index) =>
      device(`recent-${String(index).padStart(4, '0')}`, {
        name: `Device ${index}`,
        lastSeenAt: NOW - (index + 1) * MINUTE,
      }),
    )
    const stale = device('stale-0001', { name: 'iPad', lastSeenAt: NOW - 3 * DAY })
    const view = deviceListView([stale, ...recentOnes], null, NOW)

    expect(view.recent).toHaveLength(RECENT_DEVICE_LIMIT)
    expect(view.recent.map(group => group.device.name)).toEqual(
      recentOnes.slice(0, RECENT_DEVICE_LIMIT).map(one => one.name),
    )
    expect(view.older.map(group => group.device.id)).toEqual([
      'recent-0005',
      'recent-0006',
      'stale-0001',
    ])
  })

  it('keeps every online device visible, even past the limit', () => {
    const online = Array.from({ length: RECENT_DEVICE_LIMIT + 1 }, (_, index) =>
      device(`online-${String(index).padStart(4, '0')}`, { online: true, lastSeenAt: NOW }),
    )
    const view = deviceListView([...online, device('offline-01', { name: 'iPhone' })], null, NOW)
    expect(view.recent).toHaveLength(RECENT_DEVICE_LIMIT + 1)
    expect(view.older.map(group => group.device.id)).toEqual(['offline-01'])
  })
})
