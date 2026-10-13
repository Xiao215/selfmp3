import { ServerEventSchema, type ServerEvent } from '@selfmp3/shared'

/**
 * `ServerEventStream` — the server's live stream, however this platform can hear it.
 *
 * The stream carries three things: the device list as it changes, commands
 * addressed to this device, and a nudge when the library version moves. Only
 * the first has a fallback — `useDevices` polls while the stream is down — so
 * a platform that cannot open one can still *appear* in the list and drive
 * other devices, and cannot be driven itself. That difference is worth
 * declaring rather than discovering.
 *
 * A browser has `EventSource`, which reconnects on its own using the `retry:`
 * the server sends. React Native has no `EventSource` at all, which is the
 * whole reason this is a port: the phone opens the same HTTP stream over
 * `XMLHttpRequest` and does the framing itself.
 */
export interface ServerEventStream {
  /**
   * Open the stream. Returns the close.
   *
   * `onOpen` and `onClose` drive the polling fallback: while the stream is up
   * the device query stops polling, and the moment it drops the poll resumes.
   * Both may be called more than once as a connection comes and goes.
   */
  open(options: {
    url: string
    onEvent: (event: ServerEvent) => void
    onOpen: () => void
    onClose: () => void
  }): () => void
}

/**
 * One frame's `data`, as an event — or null for a frame that is not JSON or
 * not an event, which is dropped rather than thrown: a bad frame must not take
 * the stream down. Both platforms' streams read their frames with this.
 */
export function parseServerEventData(data: string): ServerEvent | null {
  let raw: unknown
  try {
    raw = JSON.parse(data)
  } catch {
    return null
  }
  const parsed = ServerEventSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}
