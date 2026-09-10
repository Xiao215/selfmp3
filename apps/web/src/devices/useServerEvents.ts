import { useEffect, useRef, useState } from 'react'
import { ServerEventSchema, type ServerEvent } from '@selfmp3/shared'
import { mediaUrl } from '../lib/api.js'

/**
 * The live event stream, as a hook.
 *
 * `EventSource` reconnects on its own using the `retry:` the server sends, so
 * the only state worth tracking is whether it is currently open — that is
 * what tells the polling fallback to stand down. Every frame is parsed
 * through the shared schema; an unknown or malformed event is dropped, never
 * thrown, because a bad frame must not take the stream down.
 */
export function useServerEvents(
  deviceId: string,
  onEvent: (event: ServerEvent) => void,
): { connected: boolean } {
  const [connected, setConnected] = useState(false)
  const handlerRef = useRef(onEvent)
  handlerRef.current = onEvent

  useEffect(() => {
    if (typeof EventSource === 'undefined') return

    const source = new EventSource(mediaUrl.events(deviceId))

    source.onopen = () => setConnected(true)
    source.onerror = () => setConnected(false)
    source.onmessage = message => {
      let raw: unknown
      try {
        raw = JSON.parse(String(message.data))
      } catch {
        return
      }
      const parsed = ServerEventSchema.safeParse(raw)
      if (parsed.success) handlerRef.current(parsed.data)
    }

    return () => {
      source.close()
      setConnected(false)
    }
  }, [deviceId])

  return { connected }
}
