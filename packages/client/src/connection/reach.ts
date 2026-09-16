import type { CloudServer } from '@selfmp3/shared'
import type { ServerConnection } from './connection.js'

/**
 * Finding the server from a device signed in to the cloud, without the screen.
 *
 * A few things only the server can do. It runs yt-dlp, so importing is its —
 * and so is seeing what a link holds before it is added. It keeps every play
 * ever recorded, so the stats are its. It asks iTunes and MusicBrainz, so
 * metadata lookup is its. The bucket holds none of that: a snapshot is the
 * library as it stands, not the history behind it or the tools beside it.
 *
 * So the screens that need it talk to it directly when this device can reach
 * it, and say so plainly when it cannot — rather than not being drawn at all,
 * which is what a device has no way of telling apart from a missing feature.
 * The server's addresses come with every snapshot it writes
 * (`CloudServerSchema`), so nothing has to be typed.
 */

/** How long one address gets to answer. A server that is on answers in a few ms. */
export const PROBE_TIMEOUT_MS = 3_000

/** How often the screen looks again, whether the server was found or not. */
export const LOOK_AGAIN_MS = 20_000

/**
 * How often presence looks again, which is a great deal less often.
 *
 * A screen is being watched: someone has it open, waiting for their stats or
 * their import to appear, and twenty seconds is about as long as that is
 * bearable. Presence is not watched by anyone — it runs for as long as the app
 * does — and a look costs a parallel connection to every address the server
 * named, each held open until it gives up. Doing that three times a minute all
 * day, on a phone, for a server that is away (which for a cloud library is the
 * ordinary case) is not a cost anybody agreed to. Once a minute finds a server
 * switched on soon enough for a handoff nobody has asked for yet.
 *
 * While the event stream is up it looks not at all: the stream *is* the
 * liveness signal, and its closing is what starts the looking again.
 */
export const PRESENCE_LOOK_AGAIN_MS = 60_000

export type Reach =
  | { readonly state: 'looking' }
  | { readonly state: 'reachable'; readonly connection: ServerConnection }
  /** `said`: whether the server's last snapshot named any address at all. */
  | { readonly state: 'away'; readonly said: boolean }

/** The server's addresses as connections to try, its token riding along. */
export function candidates(server: CloudServer | null): ServerConnection[] {
  if (!server) return []
  return server.addresses.map(baseUrl => ({ baseUrl, token: server.token }))
}

/**
 * The first of the server's addresses to answer, or null when none does.
 *
 * All are asked at once: a Wi-Fi address asked from a phone on mobile data
 * hangs until its timeout, and one after another would take a minute. On the
 * server itself `localhost` is among them and answers first.
 */
export function reachServer(
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

/**
 * What a screen needs the server for, and what can be done while it is away.
 *
 * `needs` is the end of "… goes through your server", and what is lost while it
 * is off. `meanwhile` is what the screen can still offer — importing has one,
 * because a link can be left in the bucket for the server to take when it wakes
 * (SYNC.md, rule 6), and a screen with a way forward should not be telling
 * anyone to come back later. Stats and metadata have none: the history and the
 * lookups exist only where the server is, so waiting really is the answer.
 */
export const SERVER_NEEDS = {
  import: {
    needs:
      'Importing goes through your server: it reads the link, plays a song before it is added, and downloads it.',
    meanwhile:
      'You can still add a link below — your server downloads it the next time it is awake, and it arrives here with the sync after that.',
  },
  stats: {
    needs:
      'Stats come from your server: it keeps every play any of your devices has ever recorded, and the bucket carries only the library as it stands.',
    meanwhile: null,
  },
  metadata: {
    needs:
      'Looking a song up goes through your server: it asks iTunes and MusicBrainz, and writes the corrections you pick.',
    meanwhile: null,
  },
  devices: {
    needs:
      'Your devices find each other through your server: it is the switchboard that carries a handoff from one to the other, and a storage bucket cannot hold a connection open between them.',
    meanwhile: null,
  },
} as const

export type ServerNeed = keyof typeof SERVER_NEEDS

/** What the screen says when there is no server behind what it came to show. */
export function awayCopy(said: boolean, need: ServerNeed): { title: string; body: string } {
  const { needs, meanwhile } = SERVER_NEEDS[need]
  const waiting = said
    ? 'It answers on the same Wi‑Fi, or over Tailscale. Turn it on, or come back within reach — this screen keeps looking.'
    : 'A device finds it by the addresses in its last sync. Start the current self.mp3 server and let it sync once — this screen keeps looking.'
  return {
    title: said ? 'Your server isn’t answering' : 'Your server hasn’t said where it is',
    body: `${needs} ${meanwhile ?? waiting}`,
  }
}
