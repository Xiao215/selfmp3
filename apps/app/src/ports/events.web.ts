import { parseServerEventData, type ServerEventStream } from '@selfmp3/client'
import type { ServerEvent } from '@selfmp3/shared'

/** Start here, double each refusal, and never wait longer than this. */
const FIRST_RETRY_MS = 1_000
const MAX_RETRY_MS = 30_000

/** How often each tab says it is still there. */
export const ANNOUNCE_MS = 20_000
/**
 * How long a tab can go unheard before it is counted gone — one closed without
 * a word. Several announcements' worth, because a hidden tab's timers are
 * slowed to once a minute.
 */
export const FORGET_AFTER_MS = 90_000
/** How long the tab holding the stream waits for more tabs before opening it again for them. */
export const GATHER_MS = 250

type Listeners = Omit<Parameters<ServerEventStream['open']>[0], 'url'>

/**
 * The browser's half: `EventSource`, one for all of this browser's tabs.
 *
 * A browser opens at most six connections to one address over plain HTTP, and
 * an event stream holds one for as long as it is open: with a stream per tab,
 * six tabs took every one, and every other request from every tab — playing,
 * Stats, an edit — waited behind them without end (r1 M19). So the tabs share
 * one. Whichever tab holds the Web Lock reads the stream and passes each event
 * to the others over a `BroadcastChannel`; when it closes, the next tab waiting
 * on the lock takes over and opens it again.
 *
 * Commands are addressed to one tab, and the server sends them only down a
 * stream that names it, so the stream names every tab sharing it (`deviceId`
 * once each). Tabs say they are here when they join and every `ANNOUNCE_MS`
 * after, and goodbye when they close; the tab holding the stream opens it again
 * with the new list when that changes. A tab that joins is told whether the
 * stream is up and handed the device list and library version it would have
 * been replayed by a stream of its own.
 *
 * A browser without Web Locks or `BroadcastChannel` reads a stream of its own,
 * as every tab did before.
 */
export const serverEvents: ServerEventStream = {
  open({ url, ...listeners }) {
    if (typeof EventSource === 'undefined') return () => undefined
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
    if (typeof BroadcastChannel === 'undefined' || !locks) return readStream(url, listeners)
    return shareStream(url, listeners, locks)
  },
}

/** What the tabs on one stream say to each other. */
type Note =
  /** This tab is on the stream; `fresh` the first time, when it wants telling how things stand. */
  | { readonly kind: 'here'; readonly deviceId: string; readonly fresh: boolean }
  | { readonly kind: 'bye'; readonly deviceId: string }
  /** The tab now holding the stream wants to know who is on it. */
  | { readonly kind: 'who' }
  /** An event from the stream; `for` one tab only, for a replay it asked for. */
  | { readonly kind: 'event'; readonly event: ServerEvent; readonly for?: string }
  | { readonly kind: 'state'; readonly open: boolean; readonly for?: string }

/** The stream the leading tab reads for everyone, and the ids it was opened with. */
interface Reader {
  readonly ids: string
  close: () => void
}

function shareStream(url: string, listeners: Listeners, locks: LockManager): () => void {
  const address = new URL(url, globalThis.location?.href)
  const own = address.searchParams.get('deviceId')
  address.searchParams.delete('deviceId')
  // Tabs reading the same server, with the same token, share; any other is another stream.
  const name = `selfmp3-events ${address.toString()}`
  const channel = new BroadcastChannel(name)
  const post = (note: Note): void => channel.postMessage(note)

  /** Every tab on the stream and when it was last heard from; this one is never forgotten. */
  const members = new Map<string, number>()
  if (own) members.set(own, Infinity)

  let closed = false
  /** What this tab's listeners were last told. */
  let up = false
  const tell = (open: boolean): void => {
    if (open === up) return
    up = open
    if (open) listeners.onOpen()
    else listeners.onClose()
  }

  // --- holding the stream ---------------------------------------------------

  let leading = false
  let release: (() => void) | null = null
  let reader: Reader | null = null
  let gathering: ReturnType<typeof setTimeout> | null = null
  /** What a new stream would replay first: what a tab that joins is handed. */
  const replay = new Map<ServerEvent['type'], ServerEvent>()

  const say = (open: boolean): void => {
    tell(open)
    post({ kind: 'state', open })
  }

  /** Open the stream for everyone on it now, unless it is open for exactly them already. */
  const read = (): void => {
    if (!leading || closed) return
    const wanted = [...members.keys()].sort()
    const ids = wanted.join(' ')
    if (reader?.ids === ids) return
    const target = new URL(address)
    for (const id of wanted) target.searchParams.append('deviceId', id)
    const previous = reader
    // Only the newest reader speaks: the one it replaces closing would read as a drop.
    const opened: Reader = { ids, close: () => undefined }
    const current = (): boolean => reader === opened
    reader = opened
    opened.close = readStream(target.toString(), {
      onEvent: event => {
        if (!current()) return
        if (event.type !== 'command') replay.set(event.type, event)
        listeners.onEvent(event)
        post({ kind: 'event', event })
      },
      onOpen: () => {
        if (current()) say(true)
      },
      onClose: () => {
        if (current()) say(false)
      },
    })
    previous?.close()
  }

  const gather = (): void => {
    if (!leading || gathering !== null) return
    gathering = setTimeout(() => {
      gathering = null
      read()
    }, GATHER_MS)
  }

  const lead = (): void => {
    leading = true
    read()
    // Tabs that joined before this one and have not said so since.
    post({ kind: 'who' })
  }

  // --- everyone ---------------------------------------------------------------

  const announce = (fresh: boolean): void => {
    if (own) post({ kind: 'here', deviceId: own, fresh })
  }

  channel.onmessage = ({ data }: MessageEvent<Note>) => {
    if (closed) return
    switch (data.kind) {
      case 'here': {
        const known = members.has(data.deviceId)
        if (data.deviceId !== own) members.set(data.deviceId, Date.now())
        if (!leading) return
        if (!known) gather()
        if (data.fresh) {
          post({ kind: 'state', open: up, for: data.deviceId })
          for (const event of replay.values()) post({ kind: 'event', event, for: data.deviceId })
        }
        return
      }
      case 'bye':
        if (data.deviceId === own) return
        members.delete(data.deviceId)
        gather()
        return
      case 'who':
        announce(false)
        return
      case 'event':
        if (!leading && (data.for === undefined || data.for === own)) listeners.onEvent(data.event)
        return
      case 'state':
        if (!leading && (data.for === undefined || data.for === own)) tell(data.open)
        return
    }
  }

  /** Forget tabs that went without a word; the stream drops them at its next opening. */
  const sweep = (): void => {
    const now = Date.now()
    let forgot = false
    for (const [id, heard] of members) {
      if (now - heard < FORGET_AFTER_MS) continue
      members.delete(id)
      forgot = true
    }
    if (forgot) gather()
  }
  const ticking = setInterval(() => {
    announce(false)
    sweep()
  }, ANNOUNCE_MS)

  // Closing the tab runs no cleanup; this is the goodbye it would have said.
  const leaving = (): void => {
    if (own) post({ kind: 'bye', deviceId: own })
  }
  globalThis.addEventListener?.('pagehide', leaving)

  // Where the lock cannot be had at all, this tab reads a stream of its own.
  let alone: (() => void) | null = null
  const waiting = new AbortController()
  locks
    .request(name, { signal: waiting.signal }, () => {
      if (closed) return undefined
      return new Promise<void>(resolve => {
        release = resolve
        lead()
      })
    })
    .catch(() => {
      if (closed || leading || waiting.signal.aborted) return
      alone = readStream(url, listeners)
    })

  announce(true)

  return () => {
    closed = true
    clearInterval(ticking)
    if (gathering !== null) clearTimeout(gathering)
    globalThis.removeEventListener?.('pagehide', leaving)
    waiting.abort()
    leaving()
    if (leading) {
      const holding = reader
      reader = null
      holding?.close()
      post({ kind: 'state', open: false })
      release?.()
    }
    alone?.()
    channel.close()
    listeners.onClose()
  }
}

/**
 * One `EventSource`, kept open.
 *
 * It reconnects on its own after a drop, using the `retry:` the server sends —
 * but only while it is CONNECTING. An answer that is not a 200 event stream (a
 * 502 from a proxy while the server restarts, a 503, a sign-in page) closes it
 * for good, and live updates stopped in that tab until a reload. So a closed
 * source is replaced here, backing off as the phone's reader does
 * (`events.ts`). Every frame is parsed through the shared schema and a
 * malformed one is dropped rather than thrown — a bad frame must not take the
 * stream down.
 */
function readStream(url: string, { onEvent, onOpen, onClose }: Listeners): () => void {
  let closed = false
  let source: EventSource | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let retryMs = FIRST_RETRY_MS

  const connect = (): void => {
    if (closed) return
    const opened = new EventSource(url)
    source = opened
    opened.onopen = () => {
      retryMs = FIRST_RETRY_MS
      onOpen()
    }
    opened.onerror = () => {
      onClose()
      if (closed || opened.readyState !== EventSource.CLOSED) return
      // Given up on by the browser: open a new one after a while.
      opened.onerror = null
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(connect, retryMs)
      retryMs = Math.min(retryMs * 2, MAX_RETRY_MS)
    }
    opened.onmessage = message => {
      const event = parseServerEventData(String(message.data))
      if (event) onEvent(event)
    }
  }

  connect()

  return () => {
    closed = true
    if (timer !== null) clearTimeout(timer)
    source?.close()
    onClose()
  }
}
