import { describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import type { DeviceHeartbeat } from '@selfmp3/shared'
import { migrate } from '../db/migrate.js'
import { createLogger } from '../logger.js'
import { DeviceRepository } from '../repositories/devices.js'
import { DeviceService, MAX_DEVICES, QUIET_BROADCAST_MS } from './devices.js'
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
    service.connect(sink, ['phone-000001'])
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

    const server = new BufferSink()
    const phone = new BufferSink()
    service.connect(server, ['mac-00000001'])
    service.connect(phone, ['phone-000001'])

    expect(service.command('mac-00000001', { type: 'pause' })).toBe(1)
    expect(server.text).toContain('"command":{"type":"pause"}')
    expect(phone.text).not.toContain('"pause"')

    // Known device, but nobody listening on it.
    service.heartbeat(heartbeat('tablet-00001'))
    expect(service.command('tablet-00001', { type: 'pause' })).toBe(0)
    // Unknown device.
    expect(service.command('ghost-000001', { type: 'pause' })).toBeNull()
  })

  it('forgets a device', () => {
    const { service } = setup()
    service.heartbeat(heartbeat('mac-00000001'))
    expect(service.forget('mac-00000001')).toBe(true)
    expect(service.forget('mac-00000001')).toBe(false)
    expect(service.list().devices).toEqual([])
  })

  it('forgets a device a week after it was last seen, and keeps the rest', () => {
    const { service, advance } = setup()
    service.heartbeat(heartbeat('laptop-00001'))
    advance(7 * 24 * 60 * 60 * 1000 - 1_000)
    service.heartbeat(heartbeat('phone-000001', { kind: 'phone' }))
    expect(service.forgetStale()).toBe(0)

    advance(2_000)
    expect(service.forgetStale()).toBe(1)
    expect(service.list().devices.map(device => device.id)).toEqual(['phone-000001'])
  })
})

describe('what the streams are told', () => {
  const devicesFrames = (sink: BufferSink): number =>
    sink.text.split('\n\n').filter(frame => frame.includes('"type":"devices"')).length

  it('tells nobody of a heartbeat that changed nothing, until a minute has passed', () => {
    const { service, advance } = setup()
    service.heartbeat(heartbeat('mac-00000001'))
    const sink = new BufferSink()
    service.connect(sink, ['phone-000001'])
    expect(devicesFrames(sink)).toBe(1)

    // Ten seconds on, ten seconds further into the song: nothing new.
    advance(10_000)
    service.heartbeat(
      heartbeat('mac-00000001', {
        state: { ...heartbeat('x').state, position: 20, updatedAt: START + 10_000 },
      }),
    )
    expect(devicesFrames(sink)).toBe(1)

    // A pause is news at once.
    advance(1_000)
    service.heartbeat(
      heartbeat('mac-00000001', {
        state: { ...heartbeat('x').state, position: 21, playing: false, updatedAt: START + 11_000 },
      }),
    )
    expect(devicesFrames(sink)).toBe(2)

    // And the same state again goes out once the quiet stretch is over.
    advance(QUIET_BROADCAST_MS)
    service.heartbeat(
      heartbeat('mac-00000001', {
        state: { ...heartbeat('x').state, position: 21, playing: false, updatedAt: START + 71_000 },
      }),
    )
    expect(devicesFrames(sink)).toBe(3)
  })

  it('shares only the part of a long queue around the song playing', () => {
    const { service } = setup()
    const queueIds = Array.from({ length: 10_000 }, (_, i) => i + 1)
    service.heartbeat(
      heartbeat('mac-00000001', {
        state: { ...heartbeat('x').state, songId: 5_001, queueIds, queueIndex: 5_000 },
      }),
    )
    const [device] = service.list().devices
    expect(device?.state.queueIds.length).toBeLessThan(1_000)
    expect(device?.state.queueIds[device.state.queueIndex]).toBe(5_001)
  })

  it('keeps no more than the most recently seen devices', () => {
    const { service, advance } = setup()
    for (let i = 0; i < MAX_DEVICES + 5; i++) {
      service.heartbeat(heartbeat(`device-${String(i).padStart(6, '0')}`))
      advance(1)
    }
    const ids = service.list().devices.map(device => device.id)
    expect(ids).toHaveLength(MAX_DEVICES)
    expect(ids).toContain(`device-${String(MAX_DEVICES + 4).padStart(6, '0')}`)
    expect(ids).not.toContain('device-000000')
  })
})

describe('the library-version watch', () => {
  it('tells open streams of a new version, and stops looking once none are open', () => {
    vi.useFakeTimers()
    try {
      const db = new Database(':memory:')
      migrate(db, logger)
      let version = 1
      let asked = 0
      const service = new DeviceService({
        devices: new DeviceRepository(db),
        hub: new EventHub(logger),
        logger,
        libraryVersion: () => {
          asked++
          return version
        },
      })
      service.start()
      const sink = new BufferSink()
      const close = service.connect(sink, ['phone'])

      version = 2
      vi.advanceTimersByTime(2_000)
      expect(sink.text).toContain('"version":2')

      close()
      const before = asked
      version = 3
      vi.advanceTimersByTime(10_000)
      // Nobody open: the version is not even read.
      expect(asked).toBe(before)

      // The next stream starts from the version as it is.
      const next = new BufferSink()
      service.connect(next, ['phone'])
      expect(next.text).toContain('"version":3')
      service.stop()
    } finally {
      vi.useRealTimers()
    }
  })
})
