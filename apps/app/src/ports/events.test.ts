import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ServerEventSchema, type ServerEvent } from '@selfmp3/shared'

import { serverEvents } from './events'

/**
 * The phone's server-sent-events reader, without a phone.
 *
 * React Native has no `EventSource`, so `events.ts` frames the stream itself
 * over `XMLHttpRequest`. That framing and the reconnect are the parts that can
 * be wrong in ways nothing else would catch — a frame split across two network
 * packets, a keep-alive mistaken for an event, a phone that never reconnects
 * after it sleeps — and all of them are plain logic. This runs them against a
 * fake XHR that hands over the response a piece at a time, the way a real one
 * does on readyState 3.
 *
 * What it does not show is the same code against a real server on a real phone.
 * That is still owed.
 */

class FakeXhr {
  static instances: FakeXhr[] = []
  readyState = 0
  status = 0
  responseText = ''
  onreadystatechange: (() => void) | null = null
  onerror: (() => void) | null = null
  ontimeout: (() => void) | null = null
  url = ''
  aborted = false

  constructor() {
    FakeXhr.instances.push(this)
  }
  open(_method: string, url: string): void {
    this.url = url
  }
  setRequestHeader(): void {}
  send(): void {}
  abort(): void {
    this.aborted = true
  }

  /** Headers arrive: the stream is open. */
  respond(status = 200): void {
    this.status = status
    this.readyState = 2
    this.onreadystatechange?.()
  }
  /** More of the body arrives, appended as a real XHR does. */
  push(text: string): void {
    this.responseText += text
    this.readyState = 3
    this.onreadystatechange?.()
  }
  /** The server closes the stream. */
  end(): void {
    this.readyState = 4
    this.onreadystatechange?.()
  }
}

/** An event the real schema accepts, rather than a shape guessed here. */
function validEvent(): ServerEvent {
  const candidates: unknown[] = [
    { type: 'library', version: 7 },
    { type: 'library', version: 7, now: 1 },
    { type: 'devices', devices: [], now: 1 },
  ]
  for (const candidate of candidates) {
    const parsed = ServerEventSchema.safeParse(candidate)
    if (parsed.success) return parsed.data
  }
  throw new Error('none of the candidate events satisfy ServerEventSchema; update the test')
}

const frame = (event: unknown): string => `data: ${JSON.stringify(event)}\n\n`

describe('the phone reading the server’s event stream', () => {
  let events: ServerEvent[]
  let opens: number
  let closes: number
  let close: () => void

  beforeEach(() => {
    vi.useFakeTimers()
    FakeXhr.instances = []
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
    events = []
    opens = 0
    closes = 0
    close = serverEvents.open({
      url: 'http://mac:4600/api/events?deviceId=phone',
      onEvent: event => events.push(event),
      onOpen: () => (opens += 1),
      onClose: () => (closes += 1),
    })
  })

  afterEach(() => {
    close()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  const current = (): FakeXhr => {
    const xhr = FakeXhr.instances.at(-1)
    if (!xhr) throw new Error('no request opened')
    return xhr
  }

  it('opens the stream at the URL it was given, and says so once headers arrive', () => {
    expect(current().url).toBe('http://mac:4600/api/events?deviceId=phone')
    expect(opens).toBe(0)
    current().respond()
    expect(opens).toBe(1)
  })

  it('waits for the blank line, so a frame split across two packets is one event', () => {
    const event = validEvent()
    const whole = frame(event)
    current().respond()
    current().push(whole.slice(0, 10))
    expect(events).toHaveLength(0)
    current().push(whole.slice(10))
    expect(events).toEqual([event])
  })

  it('reads two frames that arrive together as two events, in order', () => {
    const event = validEvent()
    current().respond()
    current().push(frame(event) + frame(event))
    expect(events).toEqual([event, event])
  })

  it('ignores keep-alives and malformed frames without throwing', () => {
    const event = validEvent()
    current().respond()
    expect(() =>
      current().push(': ping\n\n' + 'data: {not json\n\n' + frame({ type: 'nope' })),
    ).not.toThrow()
    expect(events).toHaveLength(0)
    current().push(frame(event))
    expect(events).toEqual([event])
  })

  it('does not hand the same frame over twice as the response keeps growing', () => {
    const event = validEvent()
    current().respond()
    current().push(frame(event))
    current().push(': ping\n\n')
    current().push(': ping\n\n')
    expect(events).toHaveLength(1)
  })

  it('reconnects when the stream drops, backing off from one second to two', () => {
    current().respond()
    current().end()
    expect(closes).toBe(1)
    expect(FakeXhr.instances).toHaveLength(1)

    vi.advanceTimersByTime(999)
    expect(FakeXhr.instances).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeXhr.instances).toHaveLength(2)

    // A second drop before it ever opens waits twice as long.
    current().onerror?.()
    vi.advanceTimersByTime(1999)
    expect(FakeXhr.instances).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(FakeXhr.instances).toHaveLength(3)
  })

  it('stops for good when closed: aborts the request and never reconnects', () => {
    current().respond()
    const request = current()
    close()
    expect(request.aborted).toBe(true)
    request.end()
    vi.advanceTimersByTime(60_000)
    expect(FakeXhr.instances).toHaveLength(1)
  })
})
