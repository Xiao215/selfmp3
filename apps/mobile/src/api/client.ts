/**
 * The phone's API client: `@selfmp3/client`, with a phone behind it.
 *
 * Everything that was here — the request layer, the error mapping, the twelve
 * endpoints — now lives in `packages/client`, which the web app uses too. Two
 * things stayed, because they are genuinely the phone's:
 *
 * The address. The phone talks to an absolute origin it was told about at
 * onboarding and carries a bearer token; the browser talks to its own page
 * origin and carries nothing. `serverTransport` is that difference.
 *
 * The timeout. A Mac that is asleep accepts the connection and then says
 * nothing, so without one a request hangs for as long as the OS allows. It
 * lives in the fetch below rather than in the package, which compiles without
 * a DOM and so cannot name an `AbortController`.
 *
 * Every endpoint the web app has now answers here too, which is most of what
 * phase 1 was for — love, tags, playlist membership and settings arrived
 * without a line being written for them.
 */
import {
  configureClient,
  createApi,
  createMediaUrl,
  serverTransport,
  type ApiTransport,
  type ServerConnection,
} from '@selfmp3/client'

import { cloudRequest } from '../cloud'
import { readCachedLibrary, writeCachedLibrary } from '../offline/libraryCache'

/** A slow request is almost always a sleeping server; do not hang forever. */
const REQUEST_TIMEOUT_MS = 15_000

/**
 * Which server answers, and whether the bucket does instead.
 *
 * Module state rather than React state on purpose: the playback service and
 * the download queue both make requests from outside the component tree, where
 * there is no context to read. `ConnectionProvider` is the only writer.
 */
let current: {
  connection: ServerConnection | null
  fromCloud: boolean
} = { connection: null, fromCloud: false }

/**
 * Say whether this device answers from the bucket.
 *
 * Not the same as having no connection: an address left over from talking to a
 * Mac is still stored, and when it is on, `connection` is ignored entirely and
 * every call is answered by `@selfmp3/cloud`'s route table from this device's
 * own copy of the library — which is why none of the screens had to change.
 */
export function answerFromCloud(on: boolean): void {
  current = { ...current, fromCloud: on }
}

/**
 * Say which Mac to talk to, or null when there is none.
 *
 * Not named `useServer`: it is a plain setter, and the `use` prefix would make
 * every call look like a React hook to both a reader and the lint rule.
 */
export function setServer(connection: ServerConnection | null): void {
  current = { ...current, connection }
}

const transport = (): ApiTransport | null =>
  current.connection ? serverTransport(current.connection) : null

/**
 * `fetch` with a deadline, which is the phone's whole contribution.
 *
 * The abort surfaces as a thrown error, which the package turns into an
 * `ApiError` with status 0 — the same "offline" the UI already knows how to
 * show for an unreachable Mac, which is exactly what a timeout means here.
 */
const fetchWithTimeout = async (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

export const api = createApi({
  context: () => ({
    transport: transport(),
    fromCloud: current.fromCloud,
    cloudRequest,
  }),
  fetch: fetchWithTimeout,
})

/*
 * Hand the shared query hooks this client, at import time.
 */
configureClient({
  api,
  librarySnapshot: {
    read: readCachedLibrary,
    // The phone's cache write is fire-and-forget by design — it hands the work
    // to a background task and returns — so there is nothing to await.
    write: async library => {
      writeCachedLibrary(library)
    },
  },
})

/**
 * A throwaway client for an address that is not this phone's yet.
 *
 * Onboarding has to prove an address before saving it — `/api/health` proves
 * the address and an authenticated call proves the token, so "wrong address"
 * and "wrong token" are different messages. It cannot use `api` for that,
 * because `api` talks to whatever is already configured, which at that moment
 * is nothing. Never answers from the bucket: the whole point is to reach a Mac.
 */
export function apiFor(connection: ServerConnection) {
  return createApi({
    context: () => ({ transport: serverTransport(connection), fromCloud: false }),
    fetch: fetchWithTimeout,
  })
}

/**
 * Media URLs for the currently connected Mac, or null when there is none.
 *
 * Mac only, and it cannot be otherwise: these are handed to the OS audio
 * player and CarPlay's image loader, neither of which lets a header be
 * attached, so the token rides in the query string. The doorman reads the
 * bearer header and nothing else — which is why a song from the bucket has to
 * be downloaded to a file and played from disk rather than streamed by URL.
 */
export function mediaUrlFor(connection: ServerConnection) {
  return createMediaUrl(serverTransport(connection))
}

export { ApiError } from '@selfmp3/client'
export type { ServerConnection } from '@selfmp3/client'
