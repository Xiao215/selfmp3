import type { ServerEvent } from '@selfmp3/shared'
import type { Logger } from '../logger.js'

/**
 * The live event stream.
 *
 * Server-Sent Events rather than WebSockets: it is one-directional (clients
 * already talk back over plain HTTP), it reconnects by itself with `retry:`,
 * it goes through `tailscale serve` and any proxy without special handling,
 * and it needs no dependency. The hub knows nothing about Express — it writes
 * to anything with a `write`, so it can be tested with a string buffer.
 */

export interface EventSink {
  write(chunk: string): void
  /**
   * Finish the response, where there is one to finish.
   *
   * An event stream is answered but never ended, so the socket under it stays
   * open for as long as the tab does — and `server.close()` waits for every
   * open socket. Without this, one tab left open is enough to stop the process
   * shutting down, and whatever the close callback was going to do (closing the
   * database, for one) never happens. Optional because the tests write to a
   * string buffer, which has nothing to end.
   */
  end?(): void
}

interface Subscriber {
  readonly sink: EventSink
  readonly deviceId: string | null
}

/** How often to send a comment so proxies do not close an idle stream. */
const KEEPALIVE_MS = 25_000

/** What a client should wait before reconnecting after a drop. */
const SSE_RETRY_MS = 3_000

/**
 * Encode one event as an SSE frame.
 *
 * The event type lives inside the JSON rather than in an `event:` field, so a
 * client can handle everything through a single `onmessage` — a named event
 * would need one listener per type and would silently drop unknown ones.
 * `data` is guaranteed single-line because JSON.stringify never emits a raw
 * newline, which keeps the frame parser on the other side trivial.
 */
export function encodeSseEvent(event: ServerEvent, id?: number): string {
  const lines: string[] = []
  if (id !== undefined) lines.push(`id: ${id}`)
  lines.push(`data: ${JSON.stringify(event)}`)
  return lines.join('\n') + '\n\n'
}

/** The preamble every new connection gets: the reconnect delay, then a comment. */
export function encodeSsePreamble(retryMs = SSE_RETRY_MS): string {
  return `retry: ${retryMs}\n: connected\n\n`
}

function encodeSseKeepalive(): string {
  return ': ping\n\n'
}

export class EventHub {
  readonly #subscribers = new Set<Subscriber>()
  readonly #logger: Logger
  #nextId = 1
  #keepalive: ReturnType<typeof setInterval> | null = null

  constructor(logger: Logger) {
    this.#logger = logger
  }

  /**
   * Add a connection. Returns the function that removes it; the route calls
   * that when the response closes.
   */
  subscribe(sink: EventSink, deviceId: string | null): () => void {
    const subscriber: Subscriber = { sink, deviceId }
    this.#subscribers.add(subscriber)
    this.#safeWrite(subscriber, encodeSsePreamble())
    this.#ensureKeepalive()
    this.#logger.debug('event stream opened', { deviceId, open: this.#subscribers.size })

    return () => {
      this.#subscribers.delete(subscriber)
      this.#logger.debug('event stream closed', { deviceId, open: this.#subscribers.size })
      if (this.#subscribers.size === 0) this.#stopKeepalive()
    }
  }

  get size(): number {
    return this.#subscribers.size
  }

  hasSubscriber(deviceId: string): boolean {
    for (const subscriber of this.#subscribers) {
      if (subscriber.deviceId === deviceId) return true
    }
    return false
  }

  /** Send to every open connection. */
  broadcast(event: ServerEvent): void {
    const frame = encodeSseEvent(event, this.#nextId++)
    for (const subscriber of this.#subscribers) this.#safeWrite(subscriber, frame)
  }

  /** Send to one connection only (used by the route to replay state on connect). */
  send(sink: EventSink, event: ServerEvent): void {
    for (const subscriber of this.#subscribers) {
      if (subscriber.sink === sink) {
        this.#safeWrite(subscriber, encodeSseEvent(event, this.#nextId++))
        return
      }
    }
  }

  /** Send to every connection of one device. Returns how many got it. */
  sendTo(deviceId: string, event: ServerEvent): number {
    const frame = encodeSseEvent(event, this.#nextId++)
    let delivered = 0
    for (const subscriber of this.#subscribers) {
      if (subscriber.deviceId !== deviceId) continue
      if (this.#safeWrite(subscriber, frame)) delivered++
    }
    return delivered
  }

  /** Close every stream. Safe to call twice; the second time has nothing left to do. */
  stop(): void {
    this.#stopKeepalive()
    const closing = [...this.#subscribers]
    this.#subscribers.clear()
    for (const subscriber of closing) {
      try {
        subscriber.sink.end?.()
      } catch (error) {
        this.#logger.debug('event stream would not close', {
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  #safeWrite(subscriber: Subscriber, chunk: string): boolean {
    try {
      subscriber.sink.write(chunk)
      return true
    } catch (error) {
      // A socket that died without a close event; drop it rather than retry.
      this.#subscribers.delete(subscriber)
      this.#logger.debug('event stream write failed', {
        message: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }

  #ensureKeepalive(): void {
    if (this.#keepalive) return
    this.#keepalive = setInterval(() => {
      const frame = encodeSseKeepalive()
      for (const subscriber of this.#subscribers) this.#safeWrite(subscriber, frame)
    }, KEEPALIVE_MS)
    // Never keep the process alive just to ping nobody.
    this.#keepalive.unref()
  }

  #stopKeepalive(): void {
    if (!this.#keepalive) return
    clearInterval(this.#keepalive)
    this.#keepalive = null
  }
}
