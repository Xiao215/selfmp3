import { describe, expect, it } from 'vitest'
import type { Device } from '@selfmp3/shared'
import { deviceGroups } from './deviceList.js'

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

describe('deviceGroups', () => {
  it('folds offline devices that share a name into one row, led by the one seen last', () => {
    const groups = deviceGroups(
      [
        device('old-000001', { lastSeenAt: NOW - 30 * MINUTE }),
        device('new-000001', { lastSeenAt: NOW - 5 * MINUTE }),
        device('pc-0000001', { name: 'Windows PC · Chrome' }),
      ],
      null,
    )
    expect(ids(groups)).toEqual([['new-000001', 'old-000001'], ['pc-0000001']])
    expect(groups[0]?.device.id).toBe('new-000001')
  })

  it('never folds this device or one online now, and puts them first', () => {
    const groups = deviceGroups(
      [
        device('offline-01', { lastSeenAt: NOW - MINUTE }),
        device('online-001', { online: true, lastSeenAt: NOW - 20 * MINUTE }),
        device('online-002', { online: true, lastSeenAt: NOW - 30 * MINUTE }),
        device('this-00001', { lastSeenAt: NOW - 2 * DAY }),
      ],
      'this-00001',
    )
    expect(ids(groups)).toEqual([['this-00001'], ['online-001'], ['online-002'], ['offline-01']])
  })
})
