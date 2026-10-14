import {
  askAddress,
  candidates,
  reachServer,
  type ClientFetch,
  type ServerConnection,
} from '@selfmp3/client/core'
import type { CloudServer } from '@selfmp3/shared'

/**
 * Where an import goes: the server itself when it answers, the bucket when it
 * does not (I3, docs/features/browser-extension.md).
 *
 * Only the server runs yt-dlp, so it is the one that can *read* a link — say
 * what it holds, and play a song before it is added. Everything the extension
 * can offer while the server is away it offers through the bucket instead: the
 * link is written there as an `importRequested` change and the server takes it
 * the next time it wakes (SYNC.md, rule 6). What is lost while away is the
 * looking, not the importing, and the popup says exactly that.
 *
 * This file only decides. It is handed the fetch it asks with, so the answers
 * below are a unit test with a fake one.
 */

export type Route =
  /** The server answers, directly: a typed-in address, or one from the bucket's snapshot. */
  | { readonly mode: 'server'; readonly connection: ServerConnection; readonly typed: boolean }
  /**
   * Signed in, but nothing answered in time: leave the link in the bucket.
   * `noServer` when no server works for this library — the bucket names none,
   * or the one it names refused the library's token — and the extension
   * leaves joining to the app (below).
   */
  | { readonly mode: 'bucket'; readonly noServer: boolean }
  /** A typed-in server that is asleep, and no account to leave the link in the bucket with. */
  | { readonly mode: 'away'; readonly connection: ServerConnection }
  /** Neither a server nor an account: the options page is the only way forward. */
  | { readonly mode: 'none' }

export interface RouteSources {
  /** The address someone typed into the options page, for a server the bucket does not name. */
  readonly typedServer: () => Promise<ServerConnection | null>
  readonly signedIn: () => Promise<boolean>
  /** The addresses the server last wrote into its snapshot, and its token; null when it names none. */
  readonly cloudServer: () => Promise<CloudServer | null>
  /** The fetch an address is asked with (`askAddress`), with a deadline of the probe's. */
  readonly fetch: ClientFetch
}

/**
 * A typed-in address wins over the bucket's, because someone typed it: it is
 * the server they meant, and it is the only one an extension that is not
 * signed in has.
 * A signed-in extension whose typed server is asleep still falls back to the
 * bucket rather than stopping, which is the whole point of I3.
 */
export async function chooseRoute(sources: RouteSources): Promise<Route> {
  const typed = await sources.typedServer()
  if (typed && (await askAddress(sources.fetch, { ...typed, serverId: undefined })) === 'works') {
    return { mode: 'server', connection: typed, typed: true }
  }

  if (!(await sources.signedIn())) {
    return typed ? { mode: 'away', connection: typed } : { mode: 'none' }
  }

  // A bucket that could not be read says nothing about whether it names a
  // server, so only a snapshot read and found naming none counts as none.
  const named = await sources.cloudServer().then(
    server => ({ server, read: true }),
    () => ({ server: null, read: false }),
  )

  // The snapshot's addresses are asked all at once: one from another network
  // hangs until its timeout, and one after another would take a minute. An
  // address counts only when the server there is the one the snapshot named
  // and takes the library's token (`askAddress`): `localhost` on a computer
  // running a development server is not that server, and one whose grant was
  // taken back answers as itself but refuses the token, while the bucket's
  // newest snapshot still names it: it can no longer write one that does not.
  const found = await reachServer(candidates(named.server), candidate =>
    askAddress(sources.fetch, candidate),
  )
  if (found && found !== 'refused') return { mode: 'server', connection: found, typed: false }

  // No server named: the app would join the shared one here (`automatic` in
  // packages/replica/src/sharedServer.ts), and the extension does not. A
  // device that removed the shared server remembers that in its own storage,
  // which the extension cannot read, so a join from here could undo that
  // Remove behind the person's back — and the extension has no Computers list
  // to show or take it back from. The app joins the first time it is opened;
  // its server publishes a snapshot naming itself, and the next look finds it
  // here. Until then the link waits in the bucket, and the popup says to open
  // self.mp3 (docs/features/browser-extension.md, "Connecting it"). A server
  // that refused is the same: the app passes it over, and joins again or
  // says no computer works for the library.
  return {
    mode: 'bucket',
    noServer: (named.read && named.server === null) || found === 'refused',
  }
}

/** How long an answer stands before the addresses are tried again. */
export const ROUTE_MEMO_MS = 60_000

export interface Router {
  route(): Promise<Route>
  /** Something changed that the answer was about: sign in, sign out, an address typed. */
  forget(): void
}

/**
 * The same answer for a minute.
 *
 * A popup asks four or five questions the moment it opens, and each of them
 * would otherwise probe every address the server ever wrote down. A minute is
 * short enough that a server switched on is found while the person is still
 * looking at the popup, and long enough that opening one costs a single probe.
 */
export function createRouter(sources: RouteSources, now = () => Date.now()): Router {
  let held: { at: number; route: Promise<Route> } | null = null

  return {
    route() {
      if (held && now() - held.at < ROUTE_MEMO_MS) return held.route
      const route: Promise<Route> = chooseRoute(sources).catch((error: unknown) => {
        // Only this answer: one asked for since `forget` is still good.
        if (held?.route === route) held = null
        throw error
      })
      held = { at: now(), route }
      return route
    },
    forget() {
      held = null
    },
  }
}
