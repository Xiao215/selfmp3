/**
 * The typed API client, for whichever platform is asking.
 *
 * Every response is parsed with the same zod schema the server validated it
 * against, so a shape mismatch surfaces immediately and loudly instead of
 * becoming `undefined is not an object` inside a component. It costs a
 * millisecond per request and has repeatedly been worth it.
 *
 * The platforms differ only in how each carries the server — the phone a
 * `ServerConnection` passed to every call, the browser its own page origin —
 * and that difference is `ApiTransport`, supplied once at startup. So every
 * mutation (love, tag, playlist membership, settings) is available everywhere
 * without a line written twice.
 *
 * The endpoints are deliberately a verbatim list: rewriting them would be 74
 * chances to change a route string nobody notices until a screen breaks.
 */
import {
  AffectedSchema,
  AnalysisStatusSchema,
  ArtistBackdropSchema,
  DeviceCommandResultSchema,
  DeviceListSchema,
  ErrorBodySchema,
  HealthSchema,
  ImportEnqueueResultSchema,
  AlreadyHaveResponseSchema,
  ImportCoverToneSchema,
  ImportFindResultSchema,
  ImportPreviewSchema,
  ImportQueueSchema,
  ImportsClearedSchema,
  ImportsPausedSchema,
  ImportsRemovedSchema,
  ImportsResumedSchema,
  ImportsRetriedSchema,
  LibrarySchema,
  LibraryVersionSchema,
  ApplyMetadataResultSchema,
  FixCoversStatusSchema,
  MetadataLookupResponseSchema,
  MetadataSuggestionSchema,
  AiCheckSchema,
  AiSetupSchema,
  AskAnswerSchema,
  AskProgressSchema,
  TidyResultSchema,
  WrittenReportSchema,
  DescribeResultSchema,
  TagReviewSchema,
  type Understanding,
  LyricsResponseSchema,
  MotionSchema,
  LyricsSearchResponseSchema,
  OkSchema,
  PlayHistorySchema,
  PlayRecordedSchema,
  PlaylistSchema,
  PlaylistSongsSchema,
  RemovedFromPlaylistSchema,
  ScanResultSchema,
  SettingsSchema,
  SimilarSongsSchema,
  SongSchema,
  StatsSchema,
  WrappedSchema,
  ForgottenGemsSchema,
  SyncManifestSchema,
  CloudUidsSchema,
  TagSchema,
  ToolStatusSchema,
  type CreateTag,
  BulkDeleteResultSchema,
  CloudStatusSchema,
  type AddToPlaylist,
  type CloudConnect,
  type ApplyMetadata,
  type BulkDeleteSongs,
  type BulkEditSongs,
  type BulkLoved,
  type BulkTag,
  type CreatePlaylist,
  type DeviceCommand,
  type DeviceHeartbeat,
  type ImportEnqueue,
  type ImportFindRequest,
  type ImportPreviewItem,
  type OfflineScope,
  type PlayEvent,
  type SongPatch,
  type StatsRange,
  type WrappedRange,
  type UpdatePlaylist,
  type UpdateSettings,
} from '@selfmp3/shared'
import type { z } from 'zod'
import {
  CloudRouteError,
  CloudServerViewSchema,
  ImportRequestListSchema,
  ImportRequestViewSchema,
  type CloudImportRequest,
} from '@selfmp3/replica'

import { ApiError } from './error.js'
import type { ApiContext, ClientFetch, ClientSignal, CloudRequest } from '../platform.js'

/**
 * Cloud answers already checked, by the object the replica answered with, then
 * by schema. The replica builds a new library object whenever anything changes
 * and hands back the same one until then, so the same object has the same
 * check: every refetch with nothing new put thousands of songs through zod.
 */
const checkedAnswers = new WeakMap<object, Map<z.ZodTypeAny, unknown>>()

/**
 * The bucket answering instead of a server.
 *
 * A `CloudRouteError` with code `offline` maps to status 0 here: status 0 is
 * what `isOffline` reads, and "the bucket is unreachable" is exactly the case
 * the UI wants to call offline.
 */
async function cloudAnswer<S extends z.ZodTypeAny>(
  cloudRequest: CloudRequest,
  method: string,
  path: string,
  schema: S,
  body: unknown,
): Promise<z.output<S>> {
  let payload: unknown
  try {
    payload = await cloudRequest(method, path, body)
  } catch (error) {
    if (error instanceof CloudRouteError) {
      throw new ApiError(error.code === 'offline' ? 0 : error.status, error.message, error.code)
    }
    throw new ApiError(0, error instanceof Error ? error.message : 'network unavailable', 'offline')
  }
  const answers = typeof payload === 'object' && payload !== null ? payload : null
  const checked = answers ? checkedAnswers.get(answers) : undefined
  if (checked?.has(schema)) return checked.get(schema)
  // A route that answers nothing is a 204 as far as the schemas are concerned.
  const parsed = parseAnswer(schema, payload, path)
  if (answers) {
    const bySchema = checked ?? new Map<z.ZodTypeAny, unknown>()
    bySchema.set(schema, parsed)
    checkedAnswers.set(answers, bySchema)
  }
  return parsed
}

/**
 * An answer checked against the schema the server validated it with. A shape
 * that does not match is surfaced rather than swallowed — that is the entire
 * point — as a 500 the screens can tell from the server being away.
 */
function parseAnswer<S extends z.ZodTypeAny>(
  schema: S,
  payload: unknown,
  path: string,
): z.output<S> {
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw new ApiError(
      500,
      `Unexpected answer from ${path}: ${parsed.error.issues[0]?.message ?? 'shape mismatch'}`,
      'contract_mismatch',
    )
  }
  return parsed.data as z.output<S>
}

/** Everything `createApi` is handed once, at startup. */
export interface ApiOptions {
  /** Read per request: on the phone the address and the session both change. */
  readonly context: () => ApiContext
  readonly fetch: ClientFetch
}

export type Api = ReturnType<typeof createApi>

export function createApi({ context, fetch }: ApiOptions) {
  /**
   * Generic over the *schema*, not over a bare `T`.
   *
   * Writing this as `schema: z.ZodType<T>` looks equivalent but is not: that
   * form is `ZodType<T, ZodTypeDef, T>`, so TypeScript can satisfy it by
   * inferring `T` from the schema's *input* type. Any schema using `.default()`
   * has an input type where those fields are optional, and the whole app then
   * ends up handling `Settings` and `SmartRules` values whose fields might be
   * undefined — which is exactly backwards, since the point of a default is
   * that the parsed output always has them.
   *
   * Constraining to `z.ZodTypeAny` and returning `z.output<S>` pins it to the
   * parsed side, which is the only side a caller ever sees.
   */
  async function request<S extends z.ZodTypeAny>(
    method: string,
    path: string,
    schema: S,
    body?: unknown,
    /** Drops the request: whoever was waiting for it has stopped. */
    signal?: ClientSignal,
  ): Promise<z.output<S>> {
    const { transport, fromCloud, cloudRequest } = context()

    // Answering from the bucket: there is no server to ask.
    if (fromCloud && cloudRequest) {
      return cloudAnswer(cloudRequest, method, path, schema, body)
    }

    if (!transport) {
      throw new ApiError(0, 'No server, and not signed in to the cloud.', 'offline')
    }

    let response
    try {
      response = await fetch(transport.url(path), {
        method,
        headers: {
          ...transport.headers?.(),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      })
    } catch (error) {
      // Stopped on purpose, not a server gone quiet.
      if (signal?.aborted) throw error
      // A network-level failure is almost always "the server is asleep" rather
      // than a bug, so it gets its own status the UI can recognise. The phone's
      // own fetch turns its fifteen-second timeout into exactly this.
      throw new ApiError(
        0,
        error instanceof Error ? error.message : 'network unavailable',
        'offline',
      )
    }

    if (response.status === 204) return schema.parse(undefined) as z.output<S>

    if (!response.ok) {
      const parsed = ErrorBodySchema.safeParse(await response.json().catch(() => null))
      throw new ApiError(
        response.status,
        parsed.success ? parsed.data.error : `${method} ${path} failed (${response.status})`,
        parsed.success ? parsed.data.code : 'error',
      )
    }

    return parseAnswer(schema, await response.json(), path)
  }

  return {
    // --- which answerer -------------------------------------------------------

    /** Whether this device's copy of the cloud library is answering, rather than a server. */
    answersFromCloud: (): boolean => {
      const { fromCloud, cloudRequest } = context()
      return fromCloud && cloudRequest !== undefined
    },

    /**
     * Hear that the cloud library changed behind an answer already given. A
     * no-op to stop on a build with no cloud; the listener only ever hears
     * the cloud library, so it is harmless to hold while a server answers.
     */
    onCloudLibraryChanged: (listener: () => void): (() => void) =>
      context().onCloudLibraryChanged?.(listener) ?? (() => undefined),

    // --- library ------------------------------------------------------------

    library: () => request('GET', '/api/library', LibrarySchema),

    libraryVersion: () => request('GET', '/api/library/version', LibraryVersionSchema),

    scan: () => request('POST', '/api/library/scan', ScanResultSchema),

    manifest: (scope: OfflineScope = 'library') =>
      request('GET', `/api/library/manifest?scope=${scope}`, SyncManifestSchema),

    analyze: (force = false) =>
      request('POST', '/api/library/analyze', AnalysisStatusSchema, { force }),

    analysisStatus: () => request('GET', '/api/library/analyze', AnalysisStatusSchema),

    // --- songs --------------------------------------------------------------

    patchSong: (id: number, patch: SongPatch) =>
      request('PATCH', `/api/songs/${id}`, SongSchema, patch),

    setSongTags: (id: number, tagIds: number[]) =>
      request('PUT', `/api/songs/${id}/tags`, SongSchema, { tagIds }),

    setLoved: (id: number, loved: boolean) =>
      request('POST', `/api/songs/${id}/loved`, SongSchema, { loved }),

    recordPlay: (id: number, event: PlayEvent) =>
      request('POST', `/api/songs/${id}/played`, PlayRecordedSchema, event),

    lyrics: (id: number) => request('GET', `/api/songs/${id}/lyrics`, LyricsResponseSchema),

    /** How loud the song is and where its hits are, over time: a 404 coded `not-analysed` until analysis has run. */
    motion: (id: number) => request('GET', `/api/songs/${id}/motion`, MotionSchema),

    // --- lyrics+ ------------------------------------------------------------

    lyricsSearch: (query: string, limit = 8) =>
      request(
        'GET',
        `/api/lyrics/search?q=${encodeURIComponent(query)}&limit=${limit}`,
        LyricsSearchResponseSchema,
      ),

    similar: (id: number, limit: number) =>
      request('GET', `/api/songs/${id}/similar?limit=${limit}`, SimilarSongsSchema),

    /** The multi-select delete. */
    bulkDeleteSongs: (input: BulkDeleteSongs) =>
      request('POST', '/api/songs/bulk/delete', BulkDeleteResultSchema, input),

    bulkEditSongs: (input: BulkEditSongs) =>
      request('POST', '/api/songs/bulk/edit', AffectedSchema, input),

    bulkLoved: (input: BulkLoved) =>
      request('POST', '/api/songs/bulk/loved', AffectedSchema, input),

    // --- metadata polish ------------------------------------------------------

    lookupMetadata: (id: number) =>
      request('GET', `/api/songs/${id}/lookup`, MetadataLookupResponseSchema),

    applyMetadata: (id: number, input: ApplyMetadata) =>
      request('POST', `/api/songs/${id}/apply-metadata`, ApplyMetadataResultSchema, input),

    fixCoversStart: () => request('POST', '/api/library/fix-covers', FixCoversStatusSchema),

    // --- smart features (docs/features/ai.md): the server's, never the bucket's

    describePlaylist: (input: {
      text: string
      understanding: Understanding | null
      avoid?: readonly number[]
    }) => request('POST', '/api/ai/describe', DescribeResultSchema, input),

    /** An answer changed after it was given (`RefineRequest`). */
    refineAnswer: (
      input: {
        text: string
        understanding: Understanding
        change: string
        shown: readonly number[]
        ticket?: string
      },
      signal?: ClientSignal,
    ) => request('POST', '/api/ai/refine', DescribeResultSchema, input, signal),

    /** The Search box's Ask: one request, routed to one thing the app can do. */
    ask: (
      text: string,
      playing: number | null = null,
      ticket?: string,
      /** What was said before, when this follows up on an answer. */
      before: readonly string[] = [],
      signal?: ClientSignal,
    ) => request('POST', '/api/ai/ask', AskAnswerSchema, { text, playing, ticket, before }, signal),

    /** How an Ask named by `ticket` is going, while its answer is on the way. */
    askProgress: (ticket: string) =>
      request(
        'GET',
        `/api/ai/ask/progress?ticket=${encodeURIComponent(ticket)}`,
        AskProgressSchema,
      ),

    untaggedTags: () => request('GET', '/api/ai/tags/untagged', TagReviewSchema),

    /** Fix metadata's Suggested card: the model's names for one song (`again`: a fresh answer). */
    suggestMetadata: (id: number, again = false, signal?: ClientSignal) =>
      request(
        'GET',
        `/api/ai/songs/${id}/metadata?again=${again ? 1 : 0}`,
        MetadataSuggestionSchema,
        undefined,
        signal,
      ),

    /** A5 · the Report in a few sentences; `again` writes it afresh. */
    written: (range: WrappedRange, again = false) =>
      request('GET', `/api/ai/written?range=${range}&again=${again ? 1 : 0}`, WrittenReportSchema),

    /** A4 · Tidy up: the song names that look wrong, as changes to approve. */
    tidy: () => request('GET', '/api/ai/tidy', TidyResultSchema),

    /** Where the server asks a model; Settings › Smart features. */
    aiSetup: () => request('GET', '/api/ai', AiSetupSchema),

    /** One small call to the model; a failure is the answer, not a thrown error. */
    checkAi: () => request('POST', '/api/ai/check', AiCheckSchema),

    fixCoversStatus: () => request('GET', '/api/library/fix-covers', FixCoversStatusSchema),

    fixCoversCancel: () => request('POST', '/api/library/fix-covers/cancel', FixCoversStatusSchema),

    // --- tags ---------------------------------------------------------------

    createTag: (tag: CreateTag) => request('POST', '/api/tags', TagSchema, tag),

    renameTag: (id: number, name: string) =>
      request('PATCH', `/api/tags/${id}`, TagSchema, { name }),

    setTagHue: (id: number, hue: number) => request('PATCH', `/api/tags/${id}`, TagSchema, { hue }),

    deleteTag: (id: number) => request('DELETE', `/api/tags/${id}`, OkSchema),

    bulkTag: (input: BulkTag) => request('POST', '/api/tags/bulk', AffectedSchema, input),

    // --- playlists ----------------------------------------------------------

    createPlaylist: (input: CreatePlaylist) =>
      request('POST', '/api/playlists', PlaylistSchema, input),

    updatePlaylist: (id: number, patch: UpdatePlaylist) =>
      request('PATCH', `/api/playlists/${id}`, PlaylistSchema, patch),

    deletePlaylist: (id: number) => request('DELETE', `/api/playlists/${id}`, OkSchema),

    /** Keep the songs it has, and stop adding more. */
    stopFollowing: (id: number) =>
      request('POST', `/api/playlists/${id}/stop-following`, PlaylistSchema),

    playlistSongs: (id: number) =>
      request('GET', `/api/playlists/${id}/songs`, PlaylistSongsSchema),

    addToPlaylist: (id: number, input: AddToPlaylist) =>
      request('POST', `/api/playlists/${id}/songs`, PlaylistSchema, input),

    removeFromPlaylist: (id: number, songId: number) =>
      request('DELETE', `/api/playlists/${id}/songs/${songId}`, PlaylistSchema),

    removeManyFromPlaylist: (id: number, songIds: number[]) =>
      request('POST', `/api/playlists/${id}/songs/remove`, RemovedFromPlaylistSchema, { songIds }),

    reorderPlaylist: (id: number, songIds: number[]) =>
      request('PUT', `/api/playlists/${id}/order`, OkSchema, { songIds }),

    /** The playlist was started, for the playlists page's "Recently played" order. */
    markPlaylistPlayed: (id: number) => request('POST', `/api/playlists/${id}/played`, OkSchema),

    // --- import -------------------------------------------------------------

    importTools: (refresh = false) =>
      request('GET', `/api/import/tools${refresh ? '?refresh=1' : ''}`, ToolStatusSchema),

    importPreview: (url: string) =>
      request('POST', '/api/import/preview', ImportPreviewSchema, { url }),

    /** Songs a review knows by name, found on YouTube, a few at a time (`/import/find`). */
    importFind: (tracks: ImportFindRequest['tracks']) =>
      request('POST', '/api/import/find', ImportFindResultSchema, { tracks }),

    /** The colour of a review song's cover, for the row that is playing it. */
    importCoverTone: (url: string) =>
      request(
        'GET',
        `/api/import/cover-tone?url=${encodeURIComponent(url)}`,
        ImportCoverToneSchema,
      ),

    /** Which of a kept review's tracks the library has now (see `refreshAlreadyHave`). */
    importAlreadyHave: (tracks: readonly ImportPreviewItem[]) =>
      request('POST', '/api/import/already-have', AlreadyHaveResponseSchema, {
        tracks: tracks.map(({ url, title, artist, duration }) => ({
          url,
          title,
          artist,
          duration,
        })),
      }),

    importEnqueue: (input: ImportEnqueue) =>
      request('POST', '/api/import/enqueue', ImportEnqueueResultSchema, input),

    /** The queue, with the newest `finished` done jobs (the server's default when unsaid). */
    importQueue: (finished?: number) =>
      request(
        'GET',
        finished === undefined ? '/api/import/queue' : `/api/import/queue?limit=${finished}`,
        ImportQueueSchema,
      ),

    cancelImport: (id: string) => request('POST', `/api/import/jobs/${id}/cancel`, OkSchema),

    retryImport: (id: string) => request('POST', `/api/import/jobs/${id}/retry`, OkSchema),

    dismissImport: (id: string) => request('DELETE', `/api/import/jobs/${id}`, OkSchema),

    importNext: (id: string) => request('POST', `/api/import/jobs/${id}/next`, OkSchema),

    pauseImports: () => request('POST', '/api/import/pause', ImportsPausedSchema),

    resumeImports: () => request('POST', '/api/import/resume', ImportsResumedSchema),

    retryFailedImports: () => request('POST', '/api/import/retry-failed', ImportsRetriedSchema),

    removeFailedImports: () => request('POST', '/api/import/remove-failed', ImportsRemovedSchema),

    clearImports: () => request('POST', '/api/import/clear', ImportsClearedSchema),

    // --- devices ------------------------------------------------------------

    devices: () => request('GET', '/api/devices', DeviceListSchema),

    heartbeat: (input: DeviceHeartbeat) =>
      request('POST', '/api/devices/heartbeat', DeviceListSchema, input),

    deviceCommand: (deviceId: string, command: DeviceCommand, fromDeviceId?: string) =>
      request(
        'POST',
        `/api/devices/${encodeURIComponent(deviceId)}/command${
          fromDeviceId ? `?from=${encodeURIComponent(fromDeviceId)}` : ''
        }`,
        DeviceCommandResultSchema,
        command,
      ),

    forgetDevice: (deviceId: string) =>
      request('DELETE', `/api/devices/${encodeURIComponent(deviceId)}`, OkSchema),

    // --- cloud --------------------------------------------------------------

    cloudStatus: () => request('GET', '/api/cloud', CloudStatusSchema),

    cloudConnect: (input: CloudConnect) => request('PUT', '/api/cloud', CloudStatusSchema, input),

    cloudDisconnect: () => request('DELETE', '/api/cloud', CloudStatusSchema),

    cloudSync: () => request('POST', '/api/cloud/sync', CloudStatusSchema),

    cloudSignIn: (attempt: string) =>
      request('POST', '/api/cloud/signin', CloudStatusSchema, { attempt }),

    cloudCancelSignIn: () => request('DELETE', '/api/cloud/signin', CloudStatusSchema),

    /** Links asked of the server, through the bucket: a cloud library's own imports (@selfmp3/replica). */
    cloudImports: () => request('GET', '/api/cloud/imports', ImportRequestListSchema),

    requestCloudImport: (input: CloudImportRequest) =>
      request('POST', '/api/cloud/imports', ImportRequestViewSchema, input),

    cancelCloudImport: (uid: string) => request('DELETE', `/api/cloud/imports/${uid}`, OkSchema),

    /** Where the server behind a cloud library listens, from its last snapshot. */
    cloudServer: () => request('GET', '/api/cloud/server', CloudServerViewSchema),

    /**
     * The uid behind each song id in whichever library answers this — this
     * device's copy, or a server asked directly. Two of these line the two
     * libraries' numbers up (connection/serverIds.ts).
     */
    cloudUids: () => request('GET', '/api/cloud/uids', CloudUidsSchema),

    /** The code Google's sign-in ended with, which claims the session. */
    cloudSignInCode: (code: string) =>
      request('POST', '/api/cloud/signin/code', CloudStatusSchema, { code }),

    cloudConnectStorage: (input: CloudConnect) =>
      request('PUT', '/api/cloud/storage', CloudStatusSchema, input),

    // --- system -------------------------------------------------------------

    health: () => request('GET', '/api/health', HealthSchema),

    settings: () => request('GET', '/api/settings', SettingsSchema),

    updateSettings: (patch: UpdateSettings) =>
      request('PATCH', '/api/settings', SettingsSchema, patch),

    stats: (range: StatsRange) => request('GET', `/api/stats?range=${range}`, StatsSchema),

    /**
     * Whether the server has a picture for this artist, finding one if it
     * can (routes/artists.ts). The picture itself is drawn from the address
     * `createMediaUrl` gives, once this names a copy.
     */
    artistBackdrop: (name: string) =>
      request(
        'GET',
        `/api/artists/backdrop?name=${encodeURIComponent(name)}`,
        ArtistBackdropSchema,
      ),

    wrapped: (range: WrappedRange) =>
      request('GET', `/api/stats/wrapped?range=${range}`, WrappedSchema),

    gems: (limit: number) =>
      request('GET', `/api/library/gems?limit=${limit}`, ForgottenGemsSchema),

    history: (limit: number) =>
      request('GET', `/api/stats/history?limit=${limit}`, PlayHistorySchema),
  }
}
