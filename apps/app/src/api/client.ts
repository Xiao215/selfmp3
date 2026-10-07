/**
 * This device's API client: `@selfmp3/client`, with this device behind it — a
 * phone, a browser tab or the desktop app.
 *
 * The request layer, the error mapping and the endpoints live in
 * `packages/client`. Two things are here instead, because they depend on where
 * the app runs:
 *
 * The address. A phone or the desktop app talks to an absolute origin it was
 * told about at onboarding and carries a bearer token; a page the server serves
 * talks to its own origin and carries nothing. `serverTransport` is that
 * difference.
 *
 * The timeout. A server that is asleep accepts the connection and then says
 * nothing, so without one a request hangs for as long as the OS allows. It
 * lives in the fetch below rather than in the package, which compiles without
 * a DOM and so cannot name an `AbortController`.
 */
import {
  configureClient,
  createApi,
  createMediaUrl,
  serverTransport,
  type ApiTransport,
  type ClientRequestInit,
  type ServerConnection,
} from '@selfmp3/client'

import { cloudRequest, library as cloudLibrary } from '../replica'
import { readCachedLibrary, writeCachedLibrary } from '../offline/libraryCache'
import { readCachedLyrics, writeCachedLyrics } from '../offline/lyricsCache'
import { readCachedMotion, writeCachedMotion } from '../offline/motionCache'
import { readCachedPlaylist, writeCachedPlaylist } from '../offline/playlistCache'

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
 * server is still stored, and when it is on, `connection` is ignored entirely and
 * every call is answered by `@selfmp3/replica`'s route table from this device's
 * own copy of the library — which is why none of the screens had to change.
 */
export function answerFromCloud(on: boolean): void {
  current = { ...current, fromCloud: on }
}

/**
 * Whether this device answers from the bucket, read outside React.
 *
 * `useConnection().fromCloud` is the same fact for anything that renders. The
 * download queue configures itself from outside the component tree and has no
 * context to read, and the answer has to be the live one: which library this
 * device holds can change without the stored server address changing at all.
 */
export function answeringFromCloud(): boolean {
  return current.fromCloud
}

/**
 * Say which server to talk to, or null when there is none.
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
 * `fetch` with a deadline, which is this device's whole contribution.
 *
 * The abort surfaces as a thrown error, which the package turns into an
 * `ApiError` with status 0 — the same "offline" the UI already knows how to
 * show for an unreachable server, which is exactly what a timeout means here.
 */
const fetchWithin = (timeoutMs: number) => async (url: string, init?: ClientRequestInit) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  // The caller's own stop (Stop pressed, nobody watching) aborts it too.
  // Joined by hand: Hermes has no AbortSignal.any.
  const given = init?.signal as AbortSignal | undefined
  const stop = (): void => controller.abort()
  if (given?.aborted) stop()
  given?.addEventListener('abort', stop)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
    given?.removeEventListener('abort', stop)
  }
}

const fetchWithTimeout = fetchWithin(REQUEST_TIMEOUT_MS)

export const api = createApi({
  context: () => ({
    transport: transport(),
    fromCloud: current.fromCloud,
    cloudRequest,
    onCloudLibraryChanged: cloudLibrary.onCloudLibraryChanged,
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
    // Nothing to await: a phone writes the file before this returns, and a
    // browser hands the write to IndexedDB and lets it land when it lands.
    write: async library => {
      writeCachedLibrary(library)
    },
  },
  playlistSnapshot: {
    read: readCachedPlaylist,
    write: async songs => {
      writeCachedPlaylist(songs)
    },
  },
  lyricsSnapshot: {
    read: readCachedLyrics,
    write: async (songId, lyrics) => {
      writeCachedLyrics(songId, lyrics)
    },
  },
  motionSnapshot: {
    read: readCachedMotion,
    write: async (songId, motion) => {
      writeCachedMotion(songId, motion)
    },
  },
})

/**
 * A throwaway client for an address that is not this device's yet.
 *
 * Onboarding has to prove an address before saving it — `/api/health` proves
 * the address and an authenticated call proves the token, so "wrong address"
 * and "wrong token" are different messages. It cannot use `api` for that,
 * because `api` talks to whatever is already configured, which at that moment
 * is nothing. Never answers from the bucket: the whole point is to reach a server.
 */
export function apiFor(connection: ServerConnection, timeoutMs: number = REQUEST_TIMEOUT_MS) {
  return createApi({
    context: () => ({ transport: serverTransport(connection), fromCloud: false }),
    fetch: timeoutMs === REQUEST_TIMEOUT_MS ? fetchWithTimeout : fetchWithin(timeoutMs),
  })
}

/**
 * Media URLs for a connected server.
 *
 * The token rides in the query string: these addresses are handed to an
 * `<audio>` element, an image loader and the lock screen, none of which lets
 * a header be attached. The bucket's addresses are another matter, since the
 * doorman reads the bearer header and nothing else (`ports/bucketMedia.ts`).
 */
export function mediaUrlFor(connection: ServerConnection) {
  return createMediaUrl(serverTransport(connection))
}
