/**
 * What this package needs of the app it happens to be running in.
 *
 * The same arrangement `packages/cloud/src/platform.ts` already uses, for the
 * same reason: this package compiles without the DOM library, so it cannot see
 * the browser's `fetch` or `Response` even when there is one. The shapes below
 * are structural and deliberately small — as much of each as this package ever
 * reads, and no more — so a browser's real `fetch` satisfies `ClientFetch` by
 * being itself, React Native's satisfies it by being itself, and a test
 * satisfies it in a dozen lines.
 *
 * The difference between the web app and the phone lives entirely here. The web
 * talks to its own origin under a base path and needs no credentials; the phone
 * talks to an absolute address it was told at onboarding, carries a bearer
 * token, and gives up after fifteen seconds because a sleeping Mac would
 * otherwise hang forever. Neither fact is visible anywhere else in the package.
 *
 * That last one is why the timeout is not a field here. `setTimeout` and
 * `AbortController` are not in the ES2023 library this package compiles
 * against — the tsconfig says so on purpose — so the phone's `ClientFetch`
 * does its own aborting and hands back a plain answer. The rule held the first
 * time it was tested, which is a good sign for it.
 */

import type { Library, LyricsResponse, OutboxEvent, PlaylistSongs } from '@selfmp3/shared'

/** As much of a response as anything here reads. */
export interface ClientResponse {
  readonly ok: boolean
  readonly status: number
  json(): Promise<unknown>
  text(): Promise<string>
}

export interface ClientRequestInit {
  method?: string
  headers?: Record<string, string>
  body?: string
  /**
   * Structural, rather than the DOM's `AbortSignal`, which this package cannot
   * name. Both platforms' real signals satisfy it.
   */
  signal?: unknown
}

export type ClientFetch = (url: string, init?: ClientRequestInit) => Promise<ClientResponse>

/**
 * How to reach the server, from wherever this is running.
 *
 * `null` where an app would otherwise supply one means there is nowhere to
 * reach — a phone that has not been told an address yet. That is a normal
 * state, not an error, and it is why `ApiContext.transport` is nullable.
 */
export interface ApiTransport {
  /** An API path (`/api/library`) becomes the URL this platform should fetch. */
  url(path: string): string
  /** Credentials, if this platform carries any. Called per request. */
  headers?(): Record<string, string>
  /**
   * Query parameters for media URLs only, and only where a header cannot be
   * sent. Stream and art URLs are handed to the OS audio player and to
   * CarPlay's image loader, neither of which lets a header be attached, so on
   * the phone the bearer token rides in the query string instead. The browser
   * needs none of this and leaves it unset.
   *
   * Deliberately separate from `headers`: a token in a URL ends up in logs and
   * in a cache key, so it is opted into for the two routes that cannot manage
   * otherwise rather than applied everywhere by default.
   */
  mediaParams?(): Record<string, string>
}

/**
 * Answering from this device's own copy of the library rather than from a Mac.
 *
 * The route table, what each call does to the library and how an error becomes
 * a status all live in `@selfmp3/cloud`. What cannot live there is the binding:
 * `createCloudRoutes` needs a platform, a session and a library replica, and
 * those are the app's. So each app builds its own `cloudRequest` and hands it
 * in here.
 */
export type CloudRequest = (method: string, path: string, body: unknown) => Promise<unknown>

/**
 * Which of the two possible answerers is live.
 *
 * When `fromCloud` is true the bucket answers every call out of this device's
 * own copy of the library and `transport` is ignored entirely — the screens
 * never learn which happened, because they ask the same questions of the same
 * paths either way.
 */
export interface ApiContext {
  readonly transport: ApiTransport | null
  readonly fromCloud: boolean
  /** Absent on a build with no cloud story; `fromCloud` is then always false. */
  readonly cloudRequest?: CloudRequest
}

/**
 * Where the last `/api/library` response is kept, so the app opens with a full
 * library on a plane rather than a spinner and an error.
 *
 * The browser puts it in IndexedDB and the phone puts it in a file. Both are
 * allowed to fail quietly: a snapshot that cannot be written is a worse
 * tomorrow, but a snapshot that throws is a broken today.
 */
export interface LibrarySnapshotStore {
  read(): Promise<Library | null>
  write(library: Library): Promise<void>
}

/**
 * The last answer to "which songs are in this playlist", per playlist.
 *
 * The library snapshot carries every playlist's name and size but not its
 * members — those are a request each — so without this a phone with every
 * song on it still could not open a playlist while its Mac was away.
 */
export interface PlaylistSnapshotStore {
  read(playlistId: number): Promise<PlaylistSongs | null>
  write(songs: PlaylistSongs): Promise<void>
}

/**
 * A song's words, kept from the last time the server had them. Read only when
 * the server cannot be reached — a song whose lyrics were removed still gets
 * its 404, not a stale copy.
 */
export interface LyricsSnapshotStore {
  read(songId: number): Promise<LyricsResponse | null>
  write(songId: number, lyrics: LyricsResponse): Promise<void>
}

/**
 * Where this device writes down the plays it has not sent yet.
 *
 * `update` rather than read-then-write because the browser's IndexedDB helper
 * does the whole thing in one transaction, and two tabs recording a play at the
 * same moment would otherwise lose one of them.
 */
export interface OutboxStore {
  read(): Promise<unknown>
  update(change: (current: unknown) => OutboxEvent[]): Promise<OutboxEvent[]>
}

/** Everything the package is handed at startup. */
export interface ClientPlatform {
  readonly fetch: ClientFetch
  /** Absent where an app has no offline story yet; the query then just fails. */
  readonly librarySnapshot?: LibrarySnapshotStore
}
