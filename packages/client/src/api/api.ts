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
  AllPlaylistSongsSchema,
  AnalysisStatusSchema,
  ArtistBackdropSchema,
  SetArtistNamesSchema,
  DeviceCommandResultSchema,
  DeviceListSchema,
  DoormanGrantsSchema,
  type UsageReport,
  ErrorBodySchema,
  HealthSchema,
  ImportEnqueueResultSchema,
  AlreadyHaveResponseSchema,
  ImportCoverToneSchema,
  ImportFindResultSchema,
  ImportSearchResultSchema,
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
  ImportNamesSchema,
  type ImportNamesRequest,
  type AskTurn,
  WrittenReportSchema,
  DescribeResultSchema,
  TagReviewSchema,
  type Understanding,
  LyricsResponseSchema,
  MotionSchema,
  LyricsSearchResponseSchema,
  OkSchema,
  PlayRecordedSchema,
  PlaylistSchema,
  PlaylistSongsSchema,
  RemovedFromPlaylistSchema,
  ScanResultSchema,
  SettingsSchema,
  SimilarSongsSchema,
  SongHistorySchema,
  UsualHoursSchema,
  SoundMapSchema,
  SongSchema,
  StatsSchema,
  WrappedSchema,
  ForgottenGemsSchema,
  SyncManifestSchema,
  CloudUidsSchema,
  TagSchema,
  ToolStatusSchema,
  type CreateTag,
  type SetArtistNames,
  BulkDeleteResultSchema,
  MergeSongsResultSchema,
  type MergeSongs,
  CloudStatusSchema,
  type AddToPlaylist,
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
  type ChangeSongTags,
  type StatsRange,
  type WrappedRange,
  type UpdatePlaylist,
  type UpdateSettings,
  type Affected,
  type BulkDeleteResult,
  type Playlist,
  type RemovedFromPlaylist,
  API_ERROR,
  BULK_IDS_MAX,
  LYRICS_QUERY_MAX,
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
import { TIMED_OUT } from '../connection/reach.js'
import type { ApiContext, ClientFetch, ClientSignal, CloudRequest } from '../platform.js'

/**
 * Cloud answers already checked, by the object the replica answered with, then
 * by schema. The replica builds a new library object whenever anything changes
 * and hands back the same one until then, so the same object has the same
 * check: every refetch with nothing new put thousands of songs through zod.
 */
const checkedAnswers = new WeakMap<object, Map<z.ZodTypeAny, unknown>>()

/**
 * A bulk request for a selection bigger than one may name (`BULK_IDS_MAX`),
 * as several, one after another: select-all over a big library failed whole
 * with a 400. Each part is told how many came before it. Always at least one
 * part, so a request for nothing is still the server's to refuse.
 */
async function inChunks<T>(
  ids: readonly number[],
  send: (part: number[], offset: number) => Promise<T>,
): Promise<T[]> {
  const answers: T[] = []
  for (let offset = 0; offset === 0 || offset < ids.length; offset += BULK_IDS_MAX) {
    answers.push(await send(ids.slice(offset, offset + BULK_IDS_MAX), offset))
  }
  return answers
}

/** How many times in all a part that sets a state is sent while its answer runs out of time. */
const SETTING_TRIES = 3

/**
 * A part of an edit that sets a state — a tag on, a heart off — asked again
 * when its answer ran out of time. A server busy with a scan applied every
 * part of a 5,040-song tag but answered one after the deadline, and the app
 * said the tag had failed (R3-m9). Setting the same thing twice is the same
 * as setting it once, so asking again is how to find out whether it landed.
 * A server that does not answer at all fails at once, as before.
 */
async function setting<T>(send: () => Promise<T>): Promise<T> {
  for (let tried = 1; ; tried++) {
    try {
      return await send()
    } catch (error) {
      const late = error instanceof ApiError && error.isOffline && error.message === TIMED_OUT
      if (!late || tried >= SETTING_TRIES) throw error
    }
  }
}

const affectedIn = (parts: readonly Affected[]): Affected => ({
  affected: parts.reduce((sum, part) => sum + part.affected, 0),
})

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
      throw new ApiError(
        error.code === API_ERROR.offline ? 0 : error.status,
        error.message,
        error.code,
      )
    }
    throw new ApiError(
      0,
      error instanceof Error ? error.message : 'network unavailable',
      API_ERROR.offline,
    )
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
      API_ERROR.contractMismatch,
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
      throw new ApiError(0, 'No server, and not signed in to the cloud.', API_ERROR.offline)
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
        API_ERROR.offline,
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

    // A body that is not JSON at all — a proxy's or a captive portal's page —
    // is the same broken contract as JSON of the wrong shape, not a crash.
    const payload: unknown = await response.json().catch(() => undefined)
    return parseAnswer(schema, payload, path)
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

    changeSongTags: (id: number, change: ChangeSongTags) =>
      request('PATCH', `/api/songs/${id}/tags`, SongSchema, change),

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
        `/api/lyrics/search?q=${encodeURIComponent(query.trim().slice(0, LYRICS_QUERY_MAX))}&limit=${limit}`,
        LyricsSearchResponseSchema,
      ),

    similar: (id: number, limit: number) =>
      request('GET', `/api/songs/${id}/similar?limit=${limit}`, SimilarSongsSchema),

    /** Every heard song's place on the sound map (docs/features/sound-map.md). */
    soundMap: () => request('GET', '/api/sound-map', SoundMapSchema),

    /** The multi-select delete. */
    bulkDeleteSongs: async (input: BulkDeleteSongs): Promise<BulkDeleteResult> => {
      const results = await inChunks(input.songIds, songIds =>
        request('POST', '/api/songs/bulk/delete', BulkDeleteResultSchema, { songIds }),
      )
      return {
        removed: results.reduce((sum, result) => sum + result.removed, 0),
        failed: results.flatMap(result => result.failed),
      }
    },

    /** Copies of one song folded into the one kept, then out of the library (`MergeSongs`). */
    mergeSongs: (input: MergeSongs) =>
      request('POST', '/api/songs/merge', MergeSongsResultSchema, input),

    bulkEditSongs: (input: BulkEditSongs) =>
      request('POST', '/api/songs/bulk/edit', AffectedSchema, input),

    bulkLoved: async (input: BulkLoved): Promise<Affected> =>
      affectedIn(
        await inChunks(input.songIds, songIds =>
          setting(() =>
            request('POST', '/api/songs/bulk/loved', AffectedSchema, { ...input, songIds }),
          ),
        ),
      ),

    // --- metadata polish ------------------------------------------------------

    lookupMetadata: (id: number) =>
      request('GET', `/api/songs/${id}/lookup`, MetadataLookupResponseSchema),

    applyMetadata: (id: number, input: ApplyMetadata) =>
      request('POST', `/api/songs/${id}/apply-metadata`, ApplyMetadataResultSchema, input),

    /** A cover taken off again, leaving the song with none: a filled-in cover's Undo. */
    removeCover: (id: number) => request('DELETE', `/api/songs/${id}/cover`, OkSchema),

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
      /** The conversation before this, when it follows up on an answer. */
      before: readonly AskTurn[] = [],
      signal?: ClientSignal,
    ) => request('POST', '/api/ai/ask', AskAnswerSchema, { text, playing, ticket, before }, signal),

    /**
     * How an Ask named by `ticket` is going, while its answer is on the way;
     * `answer` collects the answer once it is done, when the response was lost.
     */
    askProgress: (ticket: string, answer = false, signal?: ClientSignal) =>
      request(
        'GET',
        `/api/ai/ask/progress?ticket=${encodeURIComponent(ticket)}${answer ? '&answer=1' : ''}`,
        AskProgressSchema,
        undefined,
        signal,
      ),

    /** Stop: the Ask named by `ticket` goes no further, though its connection may have closed. */
    askStop: (ticket: string) => request('POST', '/api/ai/ask/stop', OkSchema, { ticket }),

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

    /** A9 · an import review's names, read by the model: better names for the rows that look wrong. */
    importNames: (input: ImportNamesRequest, signal?: ClientSignal) =>
      request('POST', '/api/ai/import/names', ImportNamesSchema, input, signal),

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

    bulkTag: async (input: BulkTag): Promise<Affected> =>
      affectedIn(
        await inChunks(input.songIds, songIds =>
          setting(() => request('POST', '/api/tags/bulk', AffectedSchema, { ...input, songIds })),
        ),
      ),

    // --- playlists ----------------------------------------------------------

    /**
     * Its first `BULK_IDS_MAX` songs come in the same request, and any past
     * that are added after, in parts: Save Up next of a big shuffled library,
     * or Duplicate of a playlist grown past it, failed whole.
     */
    createPlaylist: async (input: CreatePlaylist): Promise<Playlist> => {
      const songIds = input.kind === 'manual' ? (input.songIds ?? []) : []
      if (songIds.length <= BULK_IDS_MAX) {
        return request('POST', '/api/playlists', PlaylistSchema, input)
      }
      const made = await request('POST', '/api/playlists', PlaylistSchema, {
        ...input,
        songIds: songIds.slice(0, BULK_IDS_MAX),
      })
      const parts = await inChunks(songIds.slice(BULK_IDS_MAX), part =>
        request('POST', `/api/playlists/${made.id}/songs`, PlaylistSchema, { songIds: part }),
      )
      return parts[parts.length - 1]!
    },

    updatePlaylist: (id: number, patch: UpdatePlaylist) =>
      request('PATCH', `/api/playlists/${id}`, PlaylistSchema, patch),

    deletePlaylist: (id: number) => request('DELETE', `/api/playlists/${id}`, OkSchema),

    /** Keep the songs it has, and stop adding more. */
    stopFollowing: (id: number) =>
      request('POST', `/api/playlists/${id}/stop-following`, PlaylistSchema),

    playlistSongs: (id: number) =>
      request('GET', `/api/playlists/${id}/songs`, PlaylistSongsSchema),

    /** Every playlist's songs in one request. */
    allPlaylistSongs: () => request('GET', '/api/playlists/songs', AllPlaylistSongsSchema),

    /** A selection past `BULK_IDS_MAX` goes in parts, each after the last. */
    addToPlaylist: async (id: number, input: AddToPlaylist): Promise<Playlist> => {
      const parts = await inChunks(input.songIds, (songIds, offset) =>
        request('POST', `/api/playlists/${id}/songs`, PlaylistSchema, {
          songIds,
          ...(input.position === undefined ? {} : { position: input.position + offset }),
        }),
      )
      return parts[parts.length - 1]!
    },

    removeManyFromPlaylist: async (id: number, songIds: number[]): Promise<RemovedFromPlaylist> => {
      const parts = await inChunks(songIds, part =>
        request('POST', `/api/playlists/${id}/songs/remove`, RemovedFromPlaylistSchema, {
          songIds: part,
        }),
      )
      return {
        removed: parts.reduce((sum, part) => sum + part.removed, 0),
        playlist: parts[parts.length - 1]!.playlist,
      }
    },

    reorderPlaylist: (id: number, songIds: number[]) =>
      request('PUT', `/api/playlists/${id}/order`, OkSchema, { songIds }),

    /** The playlist was started, for the playlists page's "Recently played" order. */
    markPlaylistPlayed: (id: number) => request('POST', `/api/playlists/${id}/played`, OkSchema),

    // --- import -------------------------------------------------------------

    importTools: (refresh = false) =>
      request('GET', `/api/import/tools${refresh ? '?refresh=1' : ''}`, ToolStatusSchema),

    importPreview: (url: string) =>
      request('POST', '/api/import/preview', ImportPreviewSchema, { url }),

    /** Words looked for on YouTube Music and 网易云 at once, as review rows (`/import/search`). */
    importSearch: (query: string) =>
      request('POST', '/api/import/search', ImportSearchResultSchema, { query }),
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

    deviceCommand: (deviceId: string, command: DeviceCommand) =>
      request(
        'POST',
        `/api/devices/${encodeURIComponent(deviceId)}/command`,
        DeviceCommandResultSchema,
        command,
      ),

    forgetDevice: (deviceId: string) =>
      request('DELETE', `/api/devices/${encodeURIComponent(deviceId)}`, OkSchema),

    // --- cloud --------------------------------------------------------------

    cloudStatus: () => request('GET', '/api/cloud', CloudStatusSchema),

    /** Links asked of the server, through the bucket: a cloud library's own imports (@selfmp3/replica). */
    cloudImports: () => request('GET', '/api/cloud/imports', ImportRequestListSchema),

    requestCloudImport: (input: CloudImportRequest) =>
      request('POST', '/api/cloud/imports', ImportRequestViewSchema, input),

    cancelCloudImport: (uid: string) => request('DELETE', `/api/cloud/imports/${uid}`, OkSchema),

    /** Where the server behind a cloud library listens, from its last snapshot. */
    cloudServer: () => request('GET', '/api/cloud/server', CloudServerViewSchema),

    /**
     * That server answered as itself and refused `token`: it no longer works
     * for this library (`askAddress`). Answers where the server is now.
     */
    cloudServerRefused: (token: string) =>
      request('POST', '/api/cloud/server/refused', CloudServerViewSchema, { token }),

    /**
     * Have the shared server work for this account (docs/features/shared-server.md),
     * for a cloud library whose bucket names no server of its own.
     */
    joinSharedServer: () => request('POST', '/api/cloud/server/join', CloudServerViewSchema),

    /** The servers this account has let into its bucket, from the doorman. */
    serverGrants: () => request('GET', '/api/cloud/grants', DoormanGrantsSchema),

    /** A day of this device's feature counts, for the owner's admin page (docs/features/admin.md). */
    reportUsage: (report: UsageReport) => request('POST', '/api/usage', OkSchema, report),

    /** Take a server's way into the bucket back. */
    removeServerGrant: (id: string) => request('DELETE', `/api/cloud/grants/${id}`, OkSchema),

    /**
     * The uid behind each song id in whichever library answers this — this
     * device's copy, or a server asked directly. Two of these line the two
     * libraries' numbers up (connection/serverIds.ts).
     */
    cloudUids: () => request('GET', '/api/cloud/uids', CloudUidsSchema),

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

    /** The names an artist also goes by, all of them as they should be now: search finds them by these. */
    setArtistNames: (input: SetArtistNames) =>
      request('PUT', '/api/artists/names', SetArtistNamesSchema, input),

    wrapped: (range: WrappedRange) =>
      request('GET', `/api/stats/wrapped?range=${range}`, WrappedSchema),

    gems: (limit: number) =>
      request('GET', `/api/library/gems?limit=${limit}`, ForgottenGemsSchema),

    /** What you usually play at each hour, by this device's clock (`UsualHours`). */
    usualHours: (offsetMinutes: number) =>
      request('GET', `/api/stats/usual?offset=${offsetMinutes}`, UsualHoursSchema),

    /** One song's every play, which only a server keeps (`SongHistory`). */
    songHistory: (songId: number) =>
      request('GET', `/api/songs/${songId}/history`, SongHistorySchema),
  }
}
