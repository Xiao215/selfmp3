import {
  ApiError,
  normaliseBaseUrl,
  PROBE_TIMEOUT_MS,
  type Api,
  type ServerConnection,
} from '@selfmp3/client/core'
import { youtubeVideoId, type ImportJob } from '@selfmp3/shared'
import { z } from 'zod'
import type { Handlers, Status } from '../bridge.js'
import type { Cloud } from './cloud.js'
import { createRouter, type Route } from './connection.js'
import { LibraryCache } from './library.js'
import { serverApi } from './server.js'
import type { KeyValueStore } from './store.js'

/**
 * What the worker does with each request from a page (bridge.ts): everything
 * that talks to a server or the bucket, and nothing that draws.
 */

const SERVER_KEY = 'server'
const ServerConnectionSchema = z.object({ baseUrl: z.string(), token: z.string().nullable() })

/**
 * The library cache is keyed by which library it came from, and a cloud one has
 * no address. This stands in for it, and can never collide with a real address:
 * `normaliseBaseUrl` gives every typed-in server a scheme.
 */
const BUCKET: ServerConnection = { baseUrl: 'bucket', token: null }

/** A failure the popup shows as it is: what went wrong, and what to do about it. */
export class Refusal extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'Refusal'
    this.status = status
  }
}

/** As much of the watcher as the handlers use (watcher.ts). */
interface JobWatcher {
  add(jobs: readonly ImportJob[], label: string | null): Promise<void>
  seen(): Promise<void>
}

interface HandlerDeps {
  readonly store: KeyValueStore
  readonly fetch: typeof fetch
  /** Absent in the tests that are only about talking to a server. */
  readonly watcher?: JobWatcher
  /** The bucket. Absent in a test with no cloud in it; signing in then refuses. */
  readonly cloud?: Cloud
}

/** The server this extension imports through, if one was typed in. */
async function storedServer(store: KeyValueStore): Promise<ServerConnection | null> {
  const parsed = ServerConnectionSchema.safeParse(await store.read(SERVER_KEY))
  return parsed.success ? parsed.data : null
}

export function createHandlers({ store, fetch, watcher, cloud }: HandlerDeps): Handlers {
  const library = new LibraryCache(store)

  const router = createRouter({
    typedServer: () => storedServer(store),
    signedIn: async () => (cloud ? (await cloud.session()) !== null : false),
    cloudServer: async () => (cloud ? cloud.server() : null),
    probe: async connection => {
      try {
        await serverApi(connection, fetch, PROBE_TIMEOUT_MS).health()
        return true
      } catch {
        return false
      }
    },
  })

  /** Why a route with no way through has no way through, in the words a page shows. */
  function refuse(route: Route): Refusal {
    if (route.mode === 'away') {
      return new Refusal(
        `Nothing answered at ${route.connection.baseUrl}. Turn your server on, or sign in with Google so links can wait in your bucket.`,
        0,
      )
    }
    return new Refusal('Connect the extension to your library in its options first.', 428)
  }

  /** Whichever side answers, and the API client for it. */
  async function answering(): Promise<{
    route: Route
    api: Api
    /** Which library the cache's contents are of. */
    identity: ServerConnection
  }> {
    const route = await router.route()
    if (route.mode === 'server') {
      return { route, api: serverApi(route.connection, fetch), identity: route.connection }
    }
    if (route.mode === 'bucket' && cloud) return { route, api: cloud.api, identity: BUCKET }
    throw refuse(route)
  }

  /** The server itself, for the things only it can do: reading a link, and the queue. */
  async function direct(): Promise<Api> {
    const { route, api } = await answering()
    if (route.mode !== 'server') {
      throw new Refusal(
        'Your server has to be awake to read a link. Leave it in your bucket instead and it will be fetched when the server wakes.',
        0,
      )
    }
    return api
  }

  function needsCloud(): Cloud {
    if (!cloud) throw new Refusal('This build has no bucket to sign in to.', 501)
    return cloud
  }

  /**
   * Signed in to the bucket, whichever way the route happens to be pointing.
   *
   * A link may be left in the bucket while the server is awake — the popup
   * does not offer it, but a server that woke up between the popup drawing and
   * the button being pressed should leave what was already written alone.
   */
  async function bucket(): Promise<Cloud> {
    const side = needsCloud()
    if (!(await side.session())) {
      throw new Refusal(
        'Sign in with Google in the options, and links can wait in your bucket while the server is off.',
        428,
      )
    }
    return side
  }

  async function status(): Promise<Status> {
    const route = await router.route()
    const account = (await cloud?.session())?.me.email ?? null

    if (route.mode === 'server') {
      const server = { baseUrl: route.connection.baseUrl, typed: route.typed }
      try {
        const health = await serverApi(route.connection, fetch, PROBE_TIMEOUT_MS).health()
        return { mode: 'server', server, account, songCount: health.songCount ?? null }
      } catch {
        return { mode: 'server', server, account, songCount: null }
      }
    }
    if (route.mode === 'bucket' && cloud) {
      try {
        const { songCount } = await cloud.api.libraryVersion()
        return { mode: 'bucket', server: null, account, songCount }
      } catch {
        return { mode: 'bucket', server: null, account, songCount: null }
      }
    }
    if (route.mode === 'away') {
      return {
        mode: 'away',
        server: { baseUrl: route.connection.baseUrl, typed: true },
        account,
        songCount: null,
      }
    }
    return { mode: 'none', server: null, account, songCount: null }
  }

  return {
    status,

    async connect({ baseUrl, token }) {
      const address = normaliseBaseUrl(baseUrl)
      if (!address) {
        throw new Refusal(
          'That doesn’t look like an address. Try http://localhost:4600, or your server’s ts.net address.',
          400,
        )
      }
      const candidate: ServerConnection = { baseUrl: address, token: token?.trim() || null }
      try {
        await serverApi(candidate, fetch, PROBE_TIMEOUT_MS).health()
      } catch {
        throw new Refusal(
          `Nothing answered at ${address}. Is the self.mp3 server running, and can this computer reach it?`,
          0,
        )
      }
      // `/api/health` answers anyone. The library's version needs the token, so
      // it is what says whether the token is right.
      try {
        await serverApi(candidate, fetch).libraryVersion()
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          throw new Refusal(
            candidate.token ? 'The server refused that token.' : 'That server needs its token.',
            401,
          )
        }
        throw error
      }
      await store.write(SERVER_KEY, candidate)
      await library.forget()
      router.forget()
      return status()
    },

    async disconnect() {
      await store.remove(SERVER_KEY)
      await library.forget()
      router.forget()
      return status()
    },

    /*
     * The worker writes the attempt down and says where to go; the options page
     * is what opens it. A worker suspended while Google is slow would lose the
     * code that comes back, and the page will not be (docs/features/browser-extension.md).
     */
    signIn: async () => ({ url: await needsCloud().beginSignIn() }),

    async claimSignIn({ code }) {
      const signedIn = await needsCloud().claimSignIn(code)
      await library.forget()
      router.forget()
      // The first read of the bucket happens here, while the options page is
      // waiting on it, rather than in the first popup someone opens.
      await needsCloud().open(signedIn)
      return status()
    },

    async signOut() {
      await needsCloud().signOut()
      await library.forget()
      router.forget()
      return status()
    },

    async preview({ url }) {
      return (await direct()).importPreview(url)
    },

    async choices() {
      const { api, identity } = await answering()
      const [snapshot, settings] = await Promise.all([library.get(identity, api), api.settings()])
      return {
        tags: snapshot.tags,
        playlists: snapshot.playlists.filter(list => list.kind === 'manual'),
        defaultTagIds: settings.defaultImportTagIds,
      }
    },

    async songFor({ url }) {
      const videoId = youtubeVideoId(url)
      if (!videoId) return null
      const { api, identity } = await answering()
      return (await library.get(identity, api)).links[videoId] ?? null
    },

    async enqueue({ request, label }) {
      const result = await (await direct()).importEnqueue(request)
      // The badge and the notification are about what this extension started.
      await watcher?.add(result.jobs, label)
      return result
    },

    async queue() {
      // A page asking for the queue is someone looking at it, so a failure the
      // badge was holding up has been seen.
      void watcher?.seen()
      return (await direct()).importQueue()
    },

    async cancel({ id }) {
      return (await direct()).cancelImport(id)
    },

    async retry({ id }) {
      return (await direct()).retryImport(id)
    },

    async requestImport({ url, tagIds, playlistId }) {
      const side = await bucket()
      const made = await side.api.requestCloudImport({ url, tagIds, playlistId })
      /*
       * The replica's own flush is on a 1.5 s timer, and Chrome may stop this
       * worker before it fires — which would leave the link sitting in an
       * outbox nobody is waiting on. Sending it now is what makes "your server
       * takes it the next time it is awake" true.
       */
      await side.flush().catch(() => {
        // Still in the outbox, and sent on the next write or the next wake.
      })
      return made
    },

    async requests() {
      if (!(await cloud?.session())) return { imports: [] }
      return needsCloud().api.cloudImports()
    },

    async cancelRequest({ uid }) {
      const side = await bucket()
      const answer = await side.api.cancelCloudImport(uid)
      await side.flush().catch(() => {
        // Sent with the next write, or the next time the network comes back.
      })
      return answer
    },
  }
}

/** Any failure, in words a page can show. */
export function explain(error: unknown): { message: string; status: number } {
  if (error instanceof Refusal) return { message: error.message, status: error.status }
  if (error instanceof ApiError) {
    if (error.isOffline) return { message: 'Your server isn’t answering.', status: 0 }
    if (error.status === 401) {
      return {
        message: 'Your server refused the extension’s token. Set it again in the options.',
        status: 401,
      }
    }
    return { message: error.message, status: error.status }
  }
  return {
    message: error instanceof Error ? error.message : 'Something went wrong.',
    status: 500,
  }
}
