import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ServerEvent } from '@selfmp3/shared'

import { ANNOUNCE_MS, FORGET_AFTER_MS, GATHER_MS, serverEvents } from './events.web'

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
  send(event: ServerEvent): void {
    this.onmessage?.({ data: JSON.stringify(event) })
  }
  get deviceIds(): string[] {
    return new URL(this.url, 'http://server').searchParams.getAll('deviceId')
  }
}

/** Tabs of one browser: a message reaches every other channel of the name, a moment later. */
class FakeChannel {
  static open = new Set<FakeChannel>()
  onmessage: ((message: { data: unknown }) => void) | null = null

  constructor(readonly name: string) {
    FakeChannel.open.add(this)
  }
  postMessage(data: unknown): void {
    const copy = structuredClone(data)
    for (const other of FakeChannel.open) {
      if (other === this || other.name !== this.name) continue
      queueMicrotask(() => {
        if (FakeChannel.open.has(other)) other.onmessage?.({ data: copy })
      })
    }
  }
  close(): void {
    FakeChannel.open.delete(this)
  }
}

/** Web Locks, as much as the stream uses: one holder per name, the rest wait in turn. */
class FakeLocks {
  readonly #queues = new Map<string, { grant: () => void }[]>()
  readonly #held = new Set<string>()

  request(
    name: string,
    options: { signal?: AbortSignal },
    callback: () => Promise<void> | undefined,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const entry = {
        grant: () => {
          void Promise.resolve(callback()).then(() => {
            this.#held.delete(name)
            resolve()
            this.#next(name)
          })
        },
      }
      options.signal?.addEventListener('abort', () => {
        const queue = this.#queues.get(name) ?? []
        const at = queue.indexOf(entry)
        if (at === -1) return
        queue.splice(at, 1)
        reject(new DOMException('aborted', 'AbortError'))
      })
      const queue = this.#queues.get(name) ?? []
      this.#queues.set(name, queue)
      queue.push(entry)
      this.#next(name)
    })
  }

  #next(name: string): void {
    if (this.#held.has(name)) return
    const entry = this.#queues.get(name)?.shift()
    if (!entry) return
    this.#held.add(name)
    queueMicrotask(() => entry.grant())
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
    // One tab with nobody to share with: the stream it reads itself.
    vi.stubGlobal('navigator', {})
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

/** Let the tabs' messages and the lock's hand-overs land. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

const devicesEvent: ServerEvent = { type: 'devices', devices: [], now: 1 }
const libraryEvent: ServerEvent = { type: 'library', version: 7 }

describe('the tabs of one browser sharing the server’s event stream (r1 M19)', () => {
  interface Tab {
    readonly id: string
    readonly events: ServerEvent[]
    opens: number
    closes: number
    close: () => void
  }
  let tabs: Tab[]

  const openTab = (n: number): Tab => {
    const tab: Tab = {
      id: `browser-tab-${n}`,
      events: [],
      opens: 0,
      closes: 0,
      close: () => undefined,
    }
    tab.close = serverEvents.open({
      url: `http://server/api/events?deviceId=${tab.id}&token=t`,
      onEvent: event => tab.events.push(event),
      onOpen: () => (tab.opens += 1),
      onClose: () => (tab.closes += 1),
    })
    tabs.push(tab)
    return tab
  }
  const live = (): FakeEventSource[] => FakeEventSource.instances.filter(source => !source.closed)
  const stream = (): FakeEventSource => {
    const [only, ...more] = live()
    if (!only || more.length > 0) throw new Error(`${live().length} streams open, not one`)
    return only
  }
  const gathered = async (): Promise<void> => {
    await settle()
    vi.advanceTimersByTime(GATHER_MS)
    await settle()
  }

  beforeEach(() => {
    vi.useFakeTimers()
    FakeEventSource.instances = []
    FakeChannel.open = new Set()
    vi.stubGlobal('EventSource', FakeEventSource)
    vi.stubGlobal('BroadcastChannel', FakeChannel)
    vi.stubGlobal('navigator', { locks: new FakeLocks() })
    tabs = []
  })

  afterEach(() => {
    for (const tab of tabs) tab.close()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('keeps one stream for seven tabs, speaking for every one of them', async () => {
    for (let n = 1; n <= 7; n++) openTab(n)
    await gathered()

    expect(stream().deviceIds).toEqual(tabs.map(tab => tab.id).sort())
    expect(stream().url).toContain('token=t')
  })

  it('tells every tab when it is up and hands each the events, commands included', async () => {
    for (let n = 1; n <= 3; n++) openTab(n)
    await gathered()

    stream().open()
    await settle()
    expect(tabs.map(tab => tab.opens)).toEqual([1, 1, 1])

    const command: ServerEvent = {
      type: 'command',
      deviceId: 'browser-tab-3',
      command: { type: 'pause' },
    }
    stream().send(devicesEvent)
    stream().send(command)
    await settle()
    for (const tab of tabs) expect(tab.events).toEqual([devicesEvent, command])

    stream().drop()
    await settle()
    expect(tabs.map(tab => tab.closes)).toEqual([1, 1, 1])
  })

  it('tells a tab that joins how things stand, and nobody else again', async () => {
    const first = openTab(1)
    await gathered()
    stream().open()
    stream().send(devicesEvent)
    stream().send(libraryEvent)
    await settle()

    const late = openTab(2)
    await gathered()

    expect(late.opens).toBe(1)
    expect(late.events).toEqual([devicesEvent, libraryEvent])
    expect(first.events).toEqual([devicesEvent, libraryEvent])
    // Opened again so the server sends the new tab its commands too.
    expect(stream().deviceIds).toEqual(['browser-tab-1', 'browser-tab-2'])
  })

  it('passes the stream on when the tab holding it closes', async () => {
    const first = openTab(1)
    openTab(2)
    openTab(3)
    await gathered()
    stream().open()
    await settle()

    first.close()
    tabs.shift()
    await gathered()

    expect(tabs.map(tab => tab.closes)).toEqual([1, 1])
    expect(stream().deviceIds).toEqual(['browser-tab-2', 'browser-tab-3'])
    stream().open()
    await settle()
    expect(tabs.map(tab => tab.opens)).toEqual([2, 2])
  })

  it('drops a tab that closed, from the stream that speaks for it', async () => {
    openTab(1)
    const second = openTab(2)
    await gathered()

    second.close()
    tabs.pop()
    await gathered()

    expect(stream().deviceIds).toEqual(['browser-tab-1'])
  })

  it('forgets a tab that went without a word', async () => {
    openTab(1)
    await gathered()
    // A tab that said it was here once and was never heard from again.
    const gone = new FakeChannel(FakeChannel.open.values().next().value!.name)
    gone.postMessage({ kind: 'here', deviceId: 'browser-tab-9', fresh: true })
    await gathered()
    expect(stream().deviceIds).toEqual(['browser-tab-1', 'browser-tab-9'])
    gone.close()

    for (let waited = 0; waited <= FORGET_AFTER_MS; waited += ANNOUNCE_MS) {
      vi.advanceTimersByTime(ANNOUNCE_MS)
      await settle()
    }
    await gathered()

    expect(stream().deviceIds).toEqual(['browser-tab-1'])
  })

  it('keeps tabs that say they are still here', async () => {
    openTab(1)
    openTab(2)
    await gathered()

    for (let waited = 0; waited <= 2 * FORGET_AFTER_MS; waited += ANNOUNCE_MS) {
      vi.advanceTimersByTime(ANNOUNCE_MS)
      await settle()
    }
    await gathered()

    expect(stream().deviceIds).toEqual(['browser-tab-1', 'browser-tab-2'])
  })

  it('stops reading when the last tab closes', async () => {
    const only = openTab(1)
    await gathered()
    only.close()
    tabs.pop()
    await settle()
    expect(live()).toHaveLength(0)
  })
})
