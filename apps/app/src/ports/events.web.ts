import { parseServerEventData, type ServerEventStream } from '@selfmp3/client'

/**
 * The browser's half: `EventSource`, which is what this is for.
 *
 * It reconnects on its own using the `retry:` the server sends, so there is
 * nothing here about backoff. Every frame is parsed through the shared schema
 * and a malformed one is dropped rather than thrown — a bad frame must not
 * take the stream down.
 */
export const serverEvents: ServerEventStream = {
  open({ url, onEvent, onOpen, onClose }) {
    if (typeof EventSource === 'undefined') return () => undefined

    const source = new EventSource(url)
    source.onopen = onOpen
    source.onerror = onClose
    source.onmessage = message => {
      const event = parseServerEventData(String(message.data))
      if (event) onEvent(event)
    }

    return () => {
      source.close()
      onClose()
    }
  },
}
