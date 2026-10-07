import { ServerEventSchema } from '@selfmp3/shared'
import type { ServerEventStream } from '@selfmp3/client'

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
 * connection ends. The server sends every device's state on every heartbeat,
 * every ten seconds from each device, and the stream stays up all the while
 * music plays in a pocket, so a long evening's listening grew it by megabytes
 * an hour and made each event's scan longer than the last: the lag that came
 * with a long session, and memory iOS kills a background app for (Xiao,
 * 2026-10-07). A new connection starts empty, and the server replays the
 * current state to it as its first frames, so nothing is missed.
 */
export const RECYCLE_AFTER_CHARS = 128 * 1024

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

      /*
       * Once per connection, and only for the one this stream is reading. A
       * failed XHR reports itself twice — readyState 4 and then `onerror` (or
       * `ontimeout`) — and each used to schedule a connection of its own, so
       * every drop doubled the streams: a phone that slept and woke through an
       * evening held six at once, iOS's limit for one host, and every other
       * request to the server queued behind them until it timed out. The app
       * said the server could not be reached while it answered, tags did not
       * save, and each stream kept its own growing response (Xiao, 2026-10-07).
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
          emit(text.slice(consumed, boundary))
          consumed = boundary + 2
          boundary = text.indexOf('\n\n', consumed)
        }

        if (xhr.readyState === 4) {
          scheduleRetry()
          return
        }
        // Long enough: open a fresh one now and let this one go, without a
        // close in between — the stream never went down, so nobody falls back
        // to polling for the moment it takes.
        if (consumed >= RECYCLE_AFTER_CHARS) {
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

      const emit = (frame: string): void => {
        // `data:` is the only field the server sends that matters here;
        // comments (`:` keep-alives) and `retry:` are skipped by this test.
        const data = frame
          .split('\n')
          .filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).trim())
          .join('\n')
        if (!data) return

        let raw: unknown
        try {
          raw = JSON.parse(data)
        } catch {
          return
        }
        const parsed = ServerEventSchema.safeParse(raw)
        if (parsed.success) onEvent(parsed.data)
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
