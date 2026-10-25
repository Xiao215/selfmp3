import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { serverEvents } from './events.web'

/**
 * The browser's reader against a fake `EventSource`: what a real one does on
 * a refused answer (a 502 while the server restarts) is go CLOSED for good,
 * which is the case that left a tab with no live updates until a reload.
 */
class FakeEventSource {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2
  static instances: FakeEventSource[] = []
  readyState = FakeEventSource.CONNECTING
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((message: { data: string }) => void) | null = null
  closed = false

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this)
  }
  close(): void {
    this.closed = true
    this.readyState = FakeEventSource.CLOSED
  }
  open(): void {
    this.readyState = FakeEventSource.OPEN
    this.onopen?.()
  }
  /** A drop the browser reconnects from by itself. */
  drop(): void {
    this.readyState = FakeEventSource.CONNECTING
    this.onerror?.()
  }
  /** A non-200 answer: the browser gives up on this source. */
  refuse(): void {
    this.readyState = FakeEventSource.CLOSED
    this.onerror?.()
  }
}

describe('the browser reading the server’s event stream', () => {
  let opens: number
  let closes: number
  let close: () => void
  const current = (): FakeEventSource => {
    const source = FakeEventSource.instances.at(-1)
    if (!source) throw new Error('no stream opened')
    return source
  }

  beforeEach(() => {
    vi.useFakeTimers()
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource)
    opens = 0
    closes = 0
    close = serverEvents.open({
      url: '/api/events?deviceId=tab',
      onEvent: () => undefined,
      onOpen: () => (opens += 1),
      onClose: () => (closes += 1),
    })
  })

  afterEach(() => {
    close()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('leaves an ordinary drop to the browser’s own reconnect', () => {
    current().open()
    current().drop()
    expect(closes).toBe(1)
    vi.advanceTimersByTime(60_000)
    expect(FakeEventSource.instances).toHaveLength(1)
  })

  it('opens a new stream after a refused answer, backing off', () => {
    current().open()
    current().refuse()
    expect(closes).toBe(1)
    vi.advanceTimersByTime(999)
    expect(FakeEventSource.instances).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeEventSource.instances).toHaveLength(2)

    // Refused again before it ever opened: twice as long.
    current().refuse()
    vi.advanceTimersByTime(1999)
    expect(FakeEventSource.instances).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(FakeEventSource.instances).toHaveLength(3)

    // An open resets the wait.
    current().open()
    expect(opens).toBe(2)
    current().refuse()
    vi.advanceTimersByTime(1000)
    expect(FakeEventSource.instances).toHaveLength(4)
  })

  it('stops for good when closed, even with a reconnect waiting', () => {
    current().refuse()
    close()
    vi.advanceTimersByTime(60_000)
    expect(FakeEventSource.instances).toHaveLength(1)
  })
})
