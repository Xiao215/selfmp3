import {
  ApiError,
  normaliseBaseUrl,
  PROBE_TIMEOUT_MS,
  type Api,
  type ServerConnection,
} from '@selfmp3/client/core'
import { youtubeVideoId } from '@selfmp3/shared'
import { z } from 'zod'
import type { Handlers, Status } from '../bridge.js'
import { LibraryCache } from './library.js'
import { serverApi } from './server.js'
import type { KeyValueStore } from './store.js'

/**
 * What the worker does with each request from a page (bridge.ts): everything
 * that talks to the server, and nothing that draws.
 */

const SERVER_KEY = 'server'
const ServerConnectionSchema = z.object({ baseUrl: z.string(), token: z.string().nullable() })

/** A failure the popup shows as it is: what went wrong, and what to do about it. */
export class Refusal extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'Refusal'
    this.status = status
  }
}

export interface HandlerDeps {
  readonly store: KeyValueStore
  readonly fetch: typeof fetch
}

/** The server this extension imports through, if one is connected. */
export async function storedServer(store: KeyValueStore): Promise<ServerConnection | null> {
  const parsed = ServerConnectionSchema.safeParse(await store.read(SERVER_KEY))
  return parsed.success ? parsed.data : null
}

export function createHandlers({ store, fetch }: HandlerDeps): Handlers {
  const library = new LibraryCache(store)

  async function connected(): Promise<{ server: ServerConnection; api: Api }> {
    const server = await storedServer(store)
    if (!server) {
      throw new Refusal('Connect the extension to your self.mp3 server in its options first.', 428)
    }
    return { server, api: serverApi(server, fetch) }
  }

  async function status(): Promise<Status> {
    const server = await storedServer(store)
    if (!server) return { server: null, reachable: null, songCount: null }
    const described = { baseUrl: server.baseUrl, hasToken: server.token !== null }
    try {
      const health = await serverApi(server, fetch, PROBE_TIMEOUT_MS).health()
      return { server: described, reachable: true, songCount: health.songCount ?? null }
    } catch {
      return { server: described, reachable: false, songCount: null }
    }
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
      return status()
    },

    async disconnect() {
      await store.remove(SERVER_KEY)
      await library.forget()
      return status()
    },

    async preview({ url }) {
      return (await connected()).api.importPreview(url)
    },

    async choices() {
      const { server, api } = await connected()
      const [snapshot, settings] = await Promise.all([library.get(server, api), api.settings()])
      return {
        tags: snapshot.tags,
        playlists: snapshot.playlists.filter(list => list.kind === 'manual'),
        defaultTagIds: settings.defaultImportTagIds,
      }
    },

    async songFor({ url }) {
      const videoId = youtubeVideoId(url)
      if (!videoId) return null
      const { server, api } = await connected()
      return (await library.get(server, api)).links[videoId] ?? null
    },

    async enqueue({ request }) {
      return (await connected()).api.importEnqueue(request)
    },

    async queue() {
      return (await connected()).api.importQueue()
    },

    async cancel({ id }) {
      return (await connected()).api.cancelImport(id)
    },

    async retry({ id }) {
      return (await connected()).api.retryImport(id)
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
