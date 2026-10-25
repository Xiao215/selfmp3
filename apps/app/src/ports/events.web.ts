import { parseServerEventData, type ServerEventStream } from '@selfmp3/client'

/** Start here, double each refusal, and never wait longer than this. */
const FIRST_RETRY_MS = 1_000
const MAX_RETRY_MS = 30_000

/**
 * The browser's half: `EventSource`, which is what this is for.
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
export const serverEvents: ServerEventStream = {
  open({ url, onEvent, onOpen, onClose }) {
    if (typeof EventSource === 'undefined') return () => undefined

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
  },
}
