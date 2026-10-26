import { HealthSchema, type CloudServer } from '@selfmp3/shared'
import type { ClientFetch } from '../platform.js'
import type { ServerConnection } from './connection.js'

/**
 * Finding the server from a device signed in to the cloud, without the screen.
 *
 * A few things only the server can do. It runs yt-dlp, so importing is its —
 * and so is seeing what a link holds before it is added. It works the stats out
 * from every play, so the stats are its. It asks iTunes and MusicBrainz, so
 * metadata lookup is its. A snapshot holds none of that: it is the library as
 * it stands, not the history behind it or the tools beside it.
 *
 * So the screens that need it talk to it directly when this device can reach
 * it, and say so plainly when it cannot — rather than not being drawn at all,
 * which is what a device has no way of telling apart from a missing feature.
 * The server's addresses come with every snapshot it writes
 * (`CloudServerSchema`), so nothing has to be typed.
 */

/** How long one address gets to answer. A server that is on answers in a few ms. */
export const PROBE_TIMEOUT_MS = 3_000

/**
 * How long an ordinary request waits before the server is called asleep: a
 * slow request is almost always a sleeping server, so the app and the
 * extension both give up here rather than hang.
 */
export const REQUEST_TIMEOUT_MS = 15_000

/** What a request that ran out of time says, rather than the platform's words for its abort. */
export const TIMED_OUT = 'Your library took too long to answer.'

/** How often the screen looks again, whether the server was found or not. */
export const LOOK_AGAIN_MS = 20_000

/**
 * How long a server that was answering gets before one missed look counts.
 *
 * A server that answered a moment ago and misses one look is far more often
 * the network than the server: a phone between Wi-Fi and mobile data, an app
 * just back from the background before its network is, the server restarting
 * into an update for two seconds. So one miss is asked again after this long,
 * and only a second one says it is away.
 */
export const CONFIRM_AWAY_MS = 4_000

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

/** One of the server's addresses to try: a connection, and who must answer there. */
export interface Candidate extends ServerConnection {
  /**
   * The id the snapshot named (`CloudServerSchema.id`), which `/api/health`
   * must answer with. Undefined only for an address someone typed (the
   * extension's own server), which is the server they meant whatever it calls
   * itself, so it is held only to answering.
   */
  readonly serverId: string | undefined
}

/** The server's addresses as connections to try, its token and its id riding along. */
export function candidates(server: CloudServer | null): Candidate[] {
  if (!server) return []
  return server.addresses.map(baseUrl => ({ baseUrl, token: server.token, serverId: server.id }))
}

/**
 * Whether what an address's `/api/health` said is the server the snapshot
 * meant.
 *
 * An answer is not enough. The addresses are the ones the server found on its
 * own computer, and `http://localhost:4600` among them is whatever listens on
 * 4600 on *this* one: on the Mac a development server is, and it answers first
 * — after which every request carries this library's token to a server that
 * refuses it. A Wi-Fi address at someone else's house is the same mistake. So
 * an address counts only when the server there names itself as the snapshot
 * did, and the token goes nowhere until one has.
 */
export function answersAs(health: unknown, candidate: Candidate): boolean {
  const parsed = HealthSchema.safeParse(health)
  if (!parsed.success) return false
  // A typed address names no id, so it can only be held to an answer.
  return candidate.serverId === undefined || parsed.data.serverId === candidate.serverId
}

/**
 * What one address said when asked (`askAddress`):
 *
 * - `works`: the server the snapshot named, and it takes this library's token;
 * - `refuses`: that server, but it refuses the token — it no longer works for
 *   this library. Its account took the grant back (Settings › Account ›
 *   Computers › Remove), or it lost the library some other way, and it can no
 *   longer write the snapshot that still names it, so nothing else will say so;
 * - null: nothing answered, or something other than that server did.
 */
export type Answer = 'works' | 'refuses' | null

/**
 * Ask one address, as the app and the extension both do.
 *
 * First `/api/health` with no token: the token goes nowhere until the server
 * there has said it is the one the snapshot named (`answersAs`). Then, with
 * the token, the library's version — the cheapest question only the library
 * answers — which is how a server that answers as itself but no longer holds
 * this library shows: a 401 (2026-10-14: a removed shared server, still named
 * by the bucket, refused every import while every device kept choosing it).
 */
export async function askAddress(fetch: ClientFetch, candidate: Candidate): Promise<Answer> {
  try {
    const health = await fetch(`${candidate.baseUrl}/api/health`)
    if (!health.ok || !answersAs(await health.json(), candidate)) return null
    if (!candidate.token) return 'works'
    const library = await fetch(`${candidate.baseUrl}/api/library/version`, {
      headers: { Authorization: `Bearer ${candidate.token}` },
    })
    // Anything else is the library answering, if not well: its own screens say how.
    return library.status === 401 ? 'refuses' : 'works'
  } catch {
    return null
  }
}

/**
 * What a look at the server's addresses found: the first to answer as that
 * server and take the token; `refused` when the server answered as itself and
 * refused the token at every address that answered; null when none answered.
 */
export type Found = Candidate | 'refused' | null

/**
 * The first of the server's addresses whose answer `works` (`probe` decides,
 * usually `askAddress`).
 *
 * All are asked at once: a Wi-Fi address asked from a phone on mobile data
 * hangs until its timeout, and one after another would take a minute. On the
 * server itself `localhost` is among them and answers first.
 */
export function reachServer(
  connections: readonly Candidate[],
  probe: (candidate: Candidate) => Promise<Answer>,
): Promise<Found> {
  if (connections.length === 0) return Promise.resolve(null)
  return new Promise(resolve => {
    let left = connections.length
    let found = false
    let refused = false
    const answered = (connection: Candidate, answer: Answer): void => {
      if (found) return
      if (answer === 'works') {
        found = true
        resolve(connection)
        return
      }
      if (answer === 'refuses') refused = true
      left--
      if (left === 0) resolve(refused ? 'refused' : null)
    }
    for (const connection of connections) {
      probe(connection).then(
        answer => answered(connection, answer),
        () => answered(connection, null),
      )
    }
  })
}

/**
 * `reachServer`, asked twice before a server that was answering is given up on
 * (`CONFIRM_AWAY_MS`). `before` is what the last look found; with nothing found
 * before, one miss is the answer, so a server that is off is said to be at once.
 * A refusal is said at once too: it is the server's own answer, not a blip.
 * `wait` is the platform's timer, which this package does not assume.
 */
export async function reachServerAgain(
  connections: readonly Candidate[],
  probe: (candidate: Candidate) => Promise<Answer>,
  before: ServerConnection | null | undefined,
  wait: (ms: number) => Promise<void>,
): Promise<Found> {
  const found = await reachServer(connections, probe)
  if (found !== null || !before) return found
  await wait(CONFIRM_AWAY_MS)
  return reachServer(connections, probe)
}

/**
 * What a screen needs the server for, and what can be done while it is away.
 *
 * Said without the word: on everyday screens the server is "your library's
 * computer" — the one machine that imports, works out the stats and asks the
 * model — and the bucket is "your storage". `needs` is what goes through that
 * computer, and what is lost while it is off. `meanwhile` is what the screen
 * can still offer — importing has one, because a link can be left in the
 * bucket for the server to take when it wakes
 * (SYNC.md, rule 6), and a screen with a way forward should not be telling
 * anyone to come back later. Stats and metadata have none: the plays are kept
 * in the bucket, but only the server adds them up, and the lookups exist only
 * where the server is, so waiting really is the answer.
 * `still` is the one line the card leads with, under its title: what still
 * works, with everything else behind its Why?.
 */
const SONGS_STILL_PLAY = 'Your songs still play.'

export const SERVER_NEEDS = {
  import: {
    needs:
      'Importing goes through your library’s computer: it reads the link, plays a song before it is added, and downloads it.',
    meanwhile:
      'You can still add a link below — it’s downloaded the next time that computer is on, and turns up here soon after.',
    still: 'You can still add a link below.',
  },
  stats: {
    needs:
      'Stats are worked out on your library’s computer: it reads every play your devices have recorded and adds them up.',
    meanwhile: null,
    still: SONGS_STILL_PLAY,
  },
  metadata: {
    needs:
      'Looking a song up goes through your library’s computer: it asks iTunes and MusicBrainz, and writes the corrections you pick.',
    meanwhile: null,
    still: SONGS_STILL_PLAY,
  },
  ai: {
    needs:
      'Smart features go through your library’s computer: it holds the whole library together and does the asking.',
    meanwhile: null,
    still: SONGS_STILL_PLAY,
  },
  settings: {
    needs:
      'These settings are kept on your library’s computer: it is the one that imports, watches its folder and analyses your songs.',
    meanwhile: null,
    still: SONGS_STILL_PLAY,
  },
  devices: {
    needs:
      'Your devices find each other through your library’s computer: it carries a handoff from one to the other, which your storage can’t do.',
    meanwhile: null,
    still: SONGS_STILL_PLAY,
  },
} as const

export type ServerNeed = keyof typeof SERVER_NEEDS

/**
 * What the screen says when there is no server behind what it came to show:
 * a short title, the one line of what still works (`still`), and the rest —
 * what the computer does for this screen, and how to get it back — as `why`,
 * which the card keeps behind a Why?.
 *
 * `offered` is the server that works for anyone signed in
 * (docs/features/shared-server.md), when this build offers one: a library
 * that never had a computer is told one is there for the asking, rather than
 * to go and start one it may not have. `empty` is a library with no songs
 * yet — a brand-new account — which is not told its songs still play.
 */
export function awayCopy(
  said: boolean,
  need: ServerNeed,
  offered = false,
  empty = false,
): { title: string; body: string; why: string } {
  const { needs, meanwhile } = SERVER_NEEDS[need]
  // A library with no songs yet has none to "still play".
  const still =
    empty && SERVER_NEEDS[need].still === SONGS_STILL_PLAY
      ? 'Your library has no songs yet.'
      : SERVER_NEEDS[need].still
  if (!said && offered) {
    return {
      title: 'No computer works for your library yet',
      body: still,
      why: `${needs} The shared computer can, working in your own storage — your library stays yours.`,
    }
  }
  const waiting = said
    ? 'It answers on the same Wi‑Fi, or over Tailscale. Turn it on, or come back within reach — this screen keeps looking.'
    : 'Devices find it by the address it last left in your storage. Start the current self.mp3 on it and let it run for a minute — this screen keeps looking.'
  return {
    title: said
      ? 'Your library’s computer isn’t answering'
      : 'Your library’s computer hasn’t said where it is',
    body: still,
    why: `${needs} ${meanwhile ?? waiting}`,
  }
}
