import type { ServerConnection } from '@selfmp3/client'
import type { CloudServer } from '@selfmp3/shared'

/**
 * Finding the Mac from a device signed in to the cloud, without the screen.
 *
 * Importing is the one thing only the Mac can do — it runs yt-dlp — and the
 * one thing you want to see before it happens: the songs a link holds, to
 * choose from and to listen to first. Both need the Mac itself, so a cloud
 * library's Import screen talks to it directly when this device can reach it,
 * and says so plainly when it cannot. The Mac's addresses come with every
 * snapshot it writes (`CloudServerSchema`), so nothing has to be typed.
 */

/** How long one address gets to answer. A Mac that is on answers in a few ms. */
export const PROBE_TIMEOUT_MS = 3_000

/** How often the screen looks again, whether the Mac was found or not. */
export const LOOK_AGAIN_MS = 20_000

export type Reach =
  | { readonly state: 'looking' }
  | { readonly state: 'reachable'; readonly connection: ServerConnection }
  /** `said`: whether the Mac's last snapshot named any address at all. */
  | { readonly state: 'away'; readonly said: boolean }

/** The Mac's addresses as connections to try, its token riding along. */
export function candidates(server: CloudServer | null): ServerConnection[] {
  if (!server) return []
  return server.addresses.map(baseUrl => ({ baseUrl, token: server.token }))
}

/**
 * The first of the Mac's addresses to answer, or null when none does.
 *
 * All are asked at once: a Wi-Fi address asked from a phone on mobile data
 * hangs until its timeout, and one after another would take a minute. On the
 * Mac itself `localhost` is among them and answers first.
 */
export function reachMac(
  connections: readonly ServerConnection[],
  probe: (connection: ServerConnection) => Promise<boolean>,
): Promise<ServerConnection | null> {
  if (connections.length === 0) return Promise.resolve(null)
  return new Promise(resolve => {
    let left = connections.length
    let found = false
    const answered = (connection: ServerConnection, ok: boolean): void => {
      if (found) return
      if (ok) {
        found = true
        resolve(connection)
        return
      }
      left--
      if (left === 0) resolve(null)
    }
    for (const connection of connections) {
      probe(connection).then(
        ok => answered(connection, ok),
        () => answered(connection, false),
      )
    }
  })
}

/** What the screen says when there is no Mac to import through. */
export function awayCopy(said: boolean): { title: string; body: string } {
  return said
    ? {
        title: 'Your Mac isn’t answering',
        body:
          'Importing goes through your Mac: it reads the link, plays a song before it is added, and downloads it. ' +
          'It answers on the same Wi‑Fi, or over Tailscale. Turn it on, or come back within reach — this screen keeps looking.',
      }
    : {
        title: 'Your Mac hasn’t said where it is',
        body:
          'Importing goes through your Mac, and a device finds it by the addresses in its last sync. ' +
          'Start the current self.mp3 server on the Mac and let it sync once — this screen keeps looking.',
      }
}
