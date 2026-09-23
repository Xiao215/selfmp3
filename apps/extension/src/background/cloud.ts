import { createApi, type Api } from '@selfmp3/client/core'
import {
  createCloudLibrary,
  createCloudRoutes,
  createCloudSession,
  type CloudSession,
} from '@selfmp3/replica'
import type { CloudServer } from '@selfmp3/shared'
import { extensionCloudPlatform } from './cloudPlatform.js'
import type { KeyValueStore } from './store.js'

/**
 * The bucket, from the background worker (I3).
 *
 * The replica is this device's own copy of the library, and it is built once
 * here for the same reason the app builds it once: two of them would keep two
 * outboxes and hand out the same log sequence number twice. The worker is the
 * only context that holds it — the popup and the options page ask through the
 * bridge — so "once" is once for the whole extension.
 *
 * A worker that Chrome stopped and started again rebuilds this from IndexedDB,
 * which is where the session, the outbox and the replayed library all live.
 */

export interface Cloud {
  /** The API, answered from this device's copy of the library rather than a server. */
  readonly api: Api
  session(): Promise<CloudSession | null>
  /** Start a sign-in: the attempt is written down, and the doorman's URL comes back to be opened. */
  beginSignIn(): Promise<string>
  /** Spend the code the doorman handed back, and open the library once while the page waits. */
  claimSignIn(code: string): Promise<CloudSession>
  signOut(): Promise<void>
  /** Where the server behind this library listens, from its last snapshot. */
  server(): Promise<CloudServer | null>
  /** Send what is waiting in the outbox now, rather than on the replica's own timer. */
  flush(): Promise<void>
  /** Read the bucket once, so the first popup is not the thing that waits for it. */
  open(session: CloudSession): Promise<void>
}

export function createCloud(store: KeyValueStore, fetchImpl: typeof fetch): Cloud {
  /*
   * `beginSignIn` opens the sign-in page itself on every other device. Here the
   * page opens it, so the platform's `openSignIn` only writes the URL down and
   * the handler reads it back out of the same call.
   */
  let opening: string | null = null

  const platform = extensionCloudPlatform({
    store,
    fetch: fetchImpl,
    openSignIn: url => {
      opening = url
    },
  })

  const session = createCloudSession(platform)
  const library = createCloudLibrary(platform, session)
  const { cloudRequest } = createCloudRoutes(platform, session, library)

  const api = createApi({
    context: () => ({
      transport: null,
      fromCloud: true,
      cloudRequest,
      onCloudLibraryChanged: library.onCloudLibraryChanged,
    }),
    fetch: (url, init) => fetchImpl(url, init),
  })

  return {
    api,
    session: () => session.loadSession(),

    async beginSignIn() {
      opening = null
      await session.beginSignIn()
      if (!opening) throw new Error('The doorman’s sign-in address could not be worked out.')
      return opening
    },

    async claimSignIn(code) {
      const pending = await session.pendingSignIn()
      if (!pending) {
        throw new Error('That sign-in took too long. Press “Sign in with Google” again.')
      }
      const outcome = await session.claimSignIn(pending.attempt, code)
      if (outcome.status !== 'signed-in') {
        throw new Error('Google has not finished with that sign-in yet.')
      }
      return outcome.session
    },

    async signOut() {
      const current = await session.loadSession()
      if (current) await session.signOut(current)
      await library.forgetCloudLibrary()
    },

    async server() {
      const current = await session.loadSession()
      if (!current) return null
      return (await library.loadCloudLibrary(current)).server
    },

    flush: () => library.flushCloudChanges(),
    open: async signedIn => {
      await library.loadCloudLibrary(signedIn)
    },
  }
}
