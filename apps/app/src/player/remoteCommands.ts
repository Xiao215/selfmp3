/**
 * Next and Previous from outside the app: the lock screen, headphones, a car.
 *
 * The playback service hears them outside the React tree, where the queue is
 * not. Skipping the OS player's own queue instead went around the app's: the
 * skip counted as a finished listen, repeat-one showed one song while the next
 * played, and Previous moved forward. The service hands them here, and the
 * player provider, while it is mounted, does what its own buttons do.
 */

export type RemoteCommand = 'next' | 'previous'

type Handler = (command: RemoteCommand) => void

let handler: Handler | null = null

/** Take remote commands until the returned function is called. */
export function handleRemoteCommands(next: Handler): () => void {
  handler = next
  return () => {
    if (handler === next) handler = null
  }
}

/**
 * Pass a command to the app. False when nothing in the app is listening — an
 * Android headless task with no screens — so the service can fall back to the
 * OS player.
 */
export function sendRemoteCommand(command: RemoteCommand): boolean {
  if (!handler) return false
  handler(command)
  return true
}
