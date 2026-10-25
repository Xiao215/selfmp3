import { parseServerEventData, type ServerEventStream } from '@selfmp3/client'
import type { ServerEvent } from '@selfmp3/shared'

/**
 * The phone's half: the same HTTP stream, framed by hand.
 *
 * React Native has no `EventSource`, and its `fetch` gives no readable body to
 * stream from either. `XMLHttpRequest` does: it is the one thing in React
 * Native that hands over a response *while it is still arriving*, through
 * `responseText` growing on each readyState 3. So this opens the stream with
 * XHR and does what `EventSource` would have done — split on blank lines, read
 * the `data:` fields, ignore everything else.
 *
 * Written rather than taken from a package on purpose. Server-sent events are
 * a handful of lines of framing, the alternative is a dependency that would
 * need a line in the Stack table, and what it would buy us — reconnection —
 * is here anyway and is the part worth controlling: a phone drops its
 * connection every time it sleeps, so the backoff and the give-up are the
 * interesting behaviour rather than the parsing.
 */

/** Start here, double each failure, and never wait longer than this. */
const FIRST_RETRY_MS = 1_000
const MAX_RETRY_MS = 30_000

/**
 * How much one connection may carry before it is opened afresh.
 *
 * XHR keeps the whole response since the stream opened — `responseText` in
 * JS and the bytes behind it natively — and nothing frees either until the
 * connection ends. The server sends every device's state whenever one of them
 * changes, and at least once a minute for each, and the stream stays up all the while
 * music plays in a pocket, so a long evening's listening grew it by megabytes
 * an hour and made each event's scan longer than the last: the lag that came
 * with a long session, and memory iOS kills a background app for. A new
 * connection starts empty, and the server replays the
 * current state to it as its first frames, so nothing is missed.
 */
export const RECYCLE_AFTER_CHARS = 128 * 1024

/**
 * How long a connection is kept before it may be recycled, however much it
 * carried. The replay a new connection starts with is the whole device list,
 * and once that alone passed the limit every connection was recycled the
 * moment it opened: about a hundred a second, each downloading the list again.
 * The replay is not counted against the limit either (`replayed` below); this
 * is the floor under both, so no list, however big, can make it spin.
 */
export const MIN_CONNECTION_MS = 10_000

export const serverEvents: ServerEventStream = {
  open({ url, onEvent, onOpen, onClose }) {
    let closed = false
    let request: XMLHttpRequest | null = null
    let retryMs = FIRST_RETRY_MS
    let timer: ReturnType<typeof setTimeout> | null = null

    const connect = (): void => {
      if (closed) return

      const xhr = new XMLHttpRequest()
      request = xhr
      // How much of `responseText` has already been turned into events. XHR
      // hands over the whole response so far each time, not the new part.
      let consumed = 0
      let opened = false
      // Where the replay ended: the server opens every connection with the
      // device list and then the library version, and those are what any new
      // connection would carry again, so only what came after them counts.
      let replayed: number | null = null
      const startedAt = Date.now()

      /*
       * Once per connection, and only for the one this stream is reading. A
       * failed XHR reports itself twice — readyState 4 and then `onerror` (or
       * `ontimeout`) — and if each scheduled a connection of its own, every
       * drop would double the streams: a phone that slept and woke through an
       * evening would hold six at once, iOS's limit for one host, and every
       * other request to the server would queue behind them until it timed
       * out — the server said to be unreachable while it answered, tags not
       * saving, and each stream keeping its own growing response.
       */
      let ended = false
      const scheduleRetry = (): void => {
        if (closed || ended || request !== xhr) return
        ended = true
        onClose()
        if (timer !== null) clearTimeout(timer)
        timer = setTimeout(connect, retryMs)
        retryMs = Math.min(retryMs * 2, MAX_RETRY_MS)
      }

      xhr.onreadystatechange = () => {
        if (closed) return

        // Headers are in: the stream is up.
        if (xhr.readyState === 2 && xhr.status === 200 && !opened) {
          opened = true
          retryMs = FIRST_RETRY_MS
          onOpen()
        }

        if (xhr.readyState < 3) return

        const text = xhr.responseText
        // Frames end with a blank line. Anything after the last one is a
        // partial frame still arriving, and waits for the next tick.
        let boundary = text.indexOf('\n\n', consumed)
        while (boundary !== -1) {
          const type = emit(text.slice(consumed, boundary))
          consumed = boundary + 2
          if (replayed === null && type === 'library') replayed = consumed
          boundary = text.indexOf('\n\n', consumed)
        }

        if (xhr.readyState === 4) {
          scheduleRetry()
          return
        }
        // Long enough: open a fresh one now and let this one go, without a
        // close in between — the stream never went down, so nobody falls back
        // to polling for the moment it takes.
        if (
          consumed - (replayed ?? consumed) >= RECYCLE_AFTER_CHARS &&
          Date.now() - startedAt >= MIN_CONNECTION_MS
        ) {
          xhr.onreadystatechange = null
          xhr.onerror = null
          xhr.ontimeout = null
          try {
            xhr.abort()
          } catch {
            // Already finished; nothing to abort.
          }
          connect()
        }
      }

      xhr.onerror = scheduleRetry
      xhr.ontimeout = scheduleRetry

      /** Hand one frame over; what kind of event it was, or null for none. */
      const emit = (frame: string): ServerEvent['type'] | null => {
        // `data:` is the only field the server sends that matters here;
        // comments (`:` keep-alives) and `retry:` are skipped by this test.
        const data = frame
          .split('\n')
          .filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).trim())
          .join('\n')
        if (!data) return null
        const event = parseServerEventData(data)
        if (!event) return null
        onEvent(event)
        return event.type
      }

      try {
        xhr.open('GET', url)
        xhr.setRequestHeader('Accept', 'text/event-stream')
        xhr.send()
      } catch {
        scheduleRetry()
      }
    }

    connect()

    return () => {
      closed = true
      if (timer !== null) clearTimeout(timer)
      try {
        request?.abort()
      } catch {
        // Already finished; nothing to abort.
      }
      onClose()
    }
  },
}
