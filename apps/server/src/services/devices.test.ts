import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import type { DeviceHeartbeat } from '@selfmp3/shared'
import { migrate } from '../db/migrate.js'
import { createLogger } from '../logger.js'
import { DeviceRepository } from '../repositories/devices.js'
import { DeviceService } from './devices.js'
import { EventHub, type EventSink } from './events.js'

/**
 * The service against a real in-memory database, with an injected clock so
 * "30 seconds later" is a number rather than a wait.
 */

const logger = createLogger('silent')
const START = 1_800_000_000_000

function heartbeat(deviceId: string, patch: Partial<DeviceHeartbeat> = {}): DeviceHeartbeat {
  return {
    deviceId,
    name: deviceId,
    kind: 'desktop',
    state: {
      songId: 1,
      position: 10,
      playing: true,
      queueIds: [1, 2],
      queueIndex: 0,
      shuffle: false,
      repeat: 'off',
      updatedAt: START,
    },
    ...patch,
  }
}

function setup() {
  const db = new Database(':memory:')
  migrate(db, logger)
  let now = START
  const hub = new EventHub(logger)
  const service = new DeviceService({
    devices: new DeviceRepository(db),
    hub,
    logger,
    libraryVersion: () => 1,
    now: () => now,
  })
  return { service, hub, advance: (ms: number) => (now += ms) }
}

class BufferSink implements EventSink {
  chunks: string[] = []
  write(chunk: string): void {
    this.chunks.push(chunk)
  }
  get text(): string {
    return this.chunks.join('')
  }
}

describe('DeviceService', () => {
  it('stores heartbeats and marks devices online within the window', () => {
    const { service, advance } = setup()
    service.heartbeat(heartbeat('mac-00000001'))
    advance(29_000)
    service.heartbeat(heartbeat('phone-000001', { kind: 'phone' }))

    let list = service.list()
    expect(list.devices.map(device => [device.id, device.online])).toEqual([
      ['phone-000001', true],
      ['mac-00000001', true],
    ])

    advance(2_000)
    list = service.list()
    expect(list.devices.find(device => device.id === 'mac-00000001')?.online).toBe(false)
    expect(list.devices.find(device => device.id === 'phone-000001')?.online).toBe(true)
    // The state itself survives regardless of presence.
    expect(list.devices[1]?.state.songId).toBe(1)
  })

  it('replays the current state to a new stream and broadcasts heartbeats', () => {
    const { service } = setup()
    service.heartbeat(heartbeat('mac-00000001'))

    const sink = new BufferSink()
    service.connect(sink, 'phone-000001')
    expect(sink.text).toContain('"type":"devices"')
    expect(sink.text).toContain('"mac-00000001"')
    expect(sink.text).toContain('"type":"library"')

    service.heartbeat(heartbeat('phone-000001'))
    const frames = sink.text.split('\n\n').filter(frame => frame.includes('"type":"devices"'))
    expect(frames.length).toBe(2)
  })

  it('forwards a command to the target only and reports delivery', () => {
    const { service } = setup()
    service.heartbeat(heartbeat('mac-00000001'))
    service.heartbeat(heartbeat('phone-000001'))

    const mac = new BufferSink()
    const phone = new BufferSink()
    service.connect(mac, 'mac-00000001')
    service.connect(phone, 'phone-000001')

    expect(service.command('mac-00000001', { type: 'pause' }, 'phone-000001')).toBe(1)
    expect(mac.text).toContain('"command":{"type":"pause"}')
    expect(mac.text).toContain('"fromDeviceId":"phone-000001"')
    expect(phone.text).not.toContain('"pause"')

    // Known device, but nobody listening on it.
    service.heartbeat(heartbeat('tablet-00001'))
    expect(service.command('tablet-00001', { type: 'play' })).toBe(0)
    // Unknown device.
    expect(service.command('ghost-000001', { type: 'play' })).toBeNull()
  })

  it('forgets a device', () => {
    const { service } = setup()
    service.heartbeat(heartbeat('mac-00000001'))
    expect(service.forget('mac-00000001')).toBe(true)
    expect(service.forget('mac-00000001')).toBe(false)
    expect(service.list().devices).toEqual([])
  })
})
