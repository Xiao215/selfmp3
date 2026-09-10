import { describe, expect, it } from 'vitest'
import { createLogger } from '../logger.js'
import { encodeSseEvent, encodeSsePreamble, EventHub, type EventSink } from './events.js'

class BufferSink implements EventSink {
  chunks: string[] = []
  write(chunk: string): void {
    this.chunks.push(chunk)
  }
  get text(): string {
    return this.chunks.join('')
  }
}

describe('encodeSseEvent', () => {
  it('produces one data line per event, terminated by a blank line', () => {
    const frame = encodeSseEvent({ type: 'library', version: 7 }, 3)
    expect(frame).toBe('id: 3\ndata: {"type":"library","version":7}\n\n')
  })

  it('omits the id when none is given and never splits data across lines', () => {
    const frame = encodeSseEvent({
      type: 'command',
      deviceId: 'abcdefghij',
      command: { type: 'seek', position: 12 },
    })
    expect(frame.startsWith('data: ')).toBe(true)
    expect(frame.endsWith('\n\n')).toBe(true)
    // Exactly one newline inside the frame body besides the terminator.
    expect(frame.slice(0, -2).includes('\n')).toBe(false)
  })

  it('starts a stream with a retry hint', () => {
    expect(encodeSsePreamble(1234)).toBe('retry: 1234\n: connected\n\n')
  })
})

describe('EventHub', () => {
  const logger = createLogger('silent')

  it('sends the preamble on subscribe and broadcasts to everyone', () => {
    const hub = new EventHub(logger)
    const a = new BufferSink()
    const b = new BufferSink()
    hub.subscribe(a, 'device-aaaaaa')
    hub.subscribe(b, null)

    hub.broadcast({ type: 'library', version: 2 })

    expect(a.text.startsWith('retry: ')).toBe(true)
    expect(a.text).toContain('"version":2')
    expect(b.text).toContain('"version":2')
    hub.stop()
  })

  it('addresses commands to one device only and counts deliveries', () => {
    const hub = new EventHub(logger)
    const phone = new BufferSink()
    const phoneTab2 = new BufferSink()
    const mac = new BufferSink()
    hub.subscribe(phone, 'phone-000001')
    hub.subscribe(phoneTab2, 'phone-000001')
    hub.subscribe(mac, 'mac-00000001')

    const delivered = hub.sendTo('phone-000001', {
      type: 'command',
      deviceId: 'phone-000001',
      command: { type: 'pause' },
    })

    expect(delivered).toBe(2)
    expect(phone.text).toContain('"pause"')
    expect(phoneTab2.text).toContain('"pause"')
    expect(mac.text).not.toContain('"pause"')
    expect(hub.hasSubscriber('phone-000001')).toBe(true)
    expect(hub.hasSubscriber('nobody-0000')).toBe(false)
    hub.stop()
  })

  it('drops a subscriber whose sink throws, and honours unsubscribe', () => {
    const hub = new EventHub(logger)
    const dead: EventSink = {
      write: () => {
        throw new Error('EPIPE')
      },
    }
    const alive = new BufferSink()
    hub.subscribe(dead, 'dead-000001')
    const unsubscribe = hub.subscribe(alive, 'alive-00001')
    expect(hub.size).toBe(1) // the dead one failed on its preamble

    hub.broadcast({ type: 'library', version: 1 })
    expect(alive.text).toContain('"version":1')

    unsubscribe()
    expect(hub.size).toBe(0)
    hub.stop()
  })
})
