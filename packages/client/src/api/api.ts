/**
 * The typed API client, for whichever platform is asking.
 *
 * Every response is parsed with the same zod schema the server validated it
 * against, so a shape mismatch surfaces immediately and loudly instead of
 * becoming `undefined is not an object` inside a component. It costs a
 * millisecond per request and has repeatedly been worth it.
 *
 * This is the merge of `apps/web/src/lib/api.ts` and
 * `apps/mobile/src/api/client.ts`. The two were the same file twice, except
 * that the phone carried a `ServerConnection` through every call and the web
 * read its own page origin. That difference is now `ApiTransport`, supplied
 * once at startup, and the endpoint list below is the web's — unchanged, which
 * is how the phone gains every mutation it was missing (love, tag, playlist
 * membership, settings) without a line being written for it.
 *
 * The endpoints are deliberately a verbatim move. A rewrite here would have
 * been 74 chances to change a route string nobody would notice until a screen
 * broke.
 */
import {
  AnalysisStatusSchema,
  DeviceCommandResultSchema,
  DeviceListSchema,
  HealthSchema,
  ImportEnqueueResultSchema,
  ImportPreviewSchema,
  ImportQueueSchema,
  ImportShareResultSchema,
  YtCookieTestSchema,
  LibrarySchema,
  ApplyMetadataResultSchema,
  FixCoversStatusSchema,
  MetadataLookupResponseSchema,
  LyricsResponseSchema,
  MigrateEnqueueResultSchema,
  MigrateMatchJobSchema,
  MigrateParseResultSchema,
  LyricsSearchResponseSchema,
  RomanizedLyricsSchema,
  PlaylistSchema,
  PlaylistSongsSchema,
  ScanResultSchema,
  SettingsSchema,
  SimilarSongsSchema,
  SongSchema,
  StatsSchema,
  WrappedSchema,
  ForgottenGemsSchema,
  SyncManifestSchema,
  TagSchema,
  BulkDeleteResultSchema,
  CloudStatusSchema,
  type AddToPlaylist,
  type CloudConnect,
  type ApplyMetadata,
  type BulkDeleteSongs,
  type BulkLoved,
  type BulkTag,
  type CreatePlaylist,
  type DeviceCommand,
  type DeviceHeartbeat,
  type ImportEnqueue,
  type ImportShareRequest,
  type MigrateEnqueue,
  type MigrateSourceTrack,
  type OfflineScope,
  type PlayEvent,
  type SmartRules,
  type SongPatch,
  type StatsRange,
  type WrappedRange,
  type UpdatePlaylist,
  type UpdateSettings,
} from '@selfmp3/shared'
import { z } from 'zod'
import {
  ImportRequestListSchema,
  ImportRequestViewSchema,
  type CloudImportRequest,
} from '@selfmp3/cloud'
import { CloudRouteError } from '@selfmp3/cloud'

import { ApiError } from './error.js'
import type { ApiContext, ClientFetch, CloudRequest } from '../platform.js'

const ErrorResponseSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
})

/**
 * The bucket answering instead of a Mac.
 *
 * Both apps had this, worded differently and with one real difference: the web
 * mapped a `CloudRouteError` with code `offline` to status 0 and the phone did
 * not. Status 0 is what `isOffline` reads, and "the bucket is unreachable" is
 * exactly the case the UI wants to call offline, so the web's version is the
 * one kept.
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
  // A route that answers nothing is a 204 as far as the schemas are concerned.
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw new ApiError(
      500,
      `Unexpected answer for ${path}: ${parsed.error.issues[0]?.message ?? 'shape mismatch'}`,
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
  ): Promise<z.output<S>> {
    const { transport, fromCloud, cloudRequest } = context()

    // Answering from the bucket: there is no Mac to ask.
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
      })
    } catch (error) {
      // A network-level failure is almost always "the Mac is asleep" rather
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
      const parsed = ErrorResponseSchema.safeParse(await response.json().catch(() => null))
      throw new ApiError(
        response.status,
        parsed.success ? parsed.data.error : `${method} ${path} failed (${response.status})`,
        parsed.success ? (parsed.data.code ?? 'error') : 'error',
      )
    }

    const payload: unknown = await response.json()
    const parsed = schema.safeParse(payload)
    if (!parsed.success) {
      // Surfacing this rather than swallowing it is the entire point.
      throw new ApiError(
        500,
        `Unexpected response from ${path}: ${parsed.error.issues[0]?.message ?? 'shape mismatch'}`,
        'contract_mismatch',
      )
    }
    return parsed.data as z.output<S>
  }

  const OkSchema = z.object({ ok: z.literal(true) }).passthrough()

  return {
    // --- library ------------------------------------------------------------

    library: () => request('GET', '/api/library', LibrarySchema),

    libraryVersion: () =>
      request(
        'GET',
        '/api/library/version',
        z.object({ version: z.number(), songCount: z.number() }),
      ),

    scan: () => request('POST', '/api/library/scan', ScanResultSchema),

    purgeMissing: () =>
      request('POST', '/api/library/purge-missing', z.object({ purged: z.number() })),

    manifest: (scope: OfflineScope = 'library') =>
      request('GET', `/api/library/manifest?scope=${scope}`, SyncManifestSchema),

    analyze: (force = false) =>
      request('POST', '/api/library/analyze', AnalysisStatusSchema, { force }),

    analysisStatus: () => request('GET', '/api/library/analyze', AnalysisStatusSchema),

    search: (query: string, limit = 50) =>
      request(
        'GET',
        `/api/search?q=${encodeURIComponent(query)}&limit=${limit}`,
        z.object({ songs: z.array(SongSchema) }),
      ),

    // --- songs --------------------------------------------------------------

    patchSong: (id: number, patch: SongPatch) =>
      request('PATCH', `/api/songs/${id}`, SongSchema, patch),

    setSongTags: (id: number, tagIds: number[]) =>
      request('PUT', `/api/songs/${id}/tags`, SongSchema, { tagIds }),

    setLoved: (id: number, loved: boolean) =>
      request('POST', `/api/songs/${id}/loved`, SongSchema, { loved }),

    recordPlay: (id: number, event: PlayEvent) =>
      request('POST', `/api/songs/${id}/played`, OkSchema, event),

    recordSkip: (id: number, atSeconds: number, clientId?: string) =>
      request('POST', `/api/songs/${id}/skipped`, OkSchema, { atSeconds, clientId }),

    /** Open Finder on the server's own machine with the song's file selected. */
    revealSong: (id: number) => request('POST', `/api/songs/${id}/reveal`, OkSchema),

    lyrics: (id: number) => request('GET', `/api/songs/${id}/lyrics`, LyricsResponseSchema),

    // --- lyrics+ ------------------------------------------------------------

    romanizedLyrics: (id: number) =>
      request('GET', `/api/songs/${id}/lyrics/romanized`, RomanizedLyricsSchema),

    lyricsSearch: (query: string, limit = 8) =>
      request(
        'GET',
        `/api/lyrics/search?q=${encodeURIComponent(query)}&limit=${limit}`,
        LyricsSearchResponseSchema,
      ),

    similar: (id: number, limit = 20) =>
      request('GET', `/api/songs/${id}/similar?limit=${limit}`, SimilarSongsSchema),

    deleteSong: (id: number, deleteFile: boolean) =>
      request('DELETE', `/api/songs/${id}?deleteFile=${deleteFile ? 1 : 0}`, OkSchema),

    /** The multi-select delete. `deleteFile` is always an explicit decision. */
    bulkDeleteSongs: (input: BulkDeleteSongs) =>
      request('POST', '/api/songs/bulk/delete', BulkDeleteResultSchema, input),

    bulkLoved: (input: BulkLoved) =>
      request('POST', '/api/songs/bulk/loved', z.object({ affected: z.number() }), input),

    // --- metadata polish ------------------------------------------------------

    lookupMetadata: (id: number) =>
      request('GET', `/api/songs/${id}/lookup`, MetadataLookupResponseSchema),

    applyMetadata: (id: number, input: ApplyMetadata) =>
      request('POST', `/api/songs/${id}/apply-metadata`, ApplyMetadataResultSchema, input),

    fixCoversStart: () => request('POST', '/api/library/fix-covers', FixCoversStatusSchema),

    fixCoversStatus: () => request('GET', '/api/library/fix-covers', FixCoversStatusSchema),

    fixCoversCancel: () => request('POST', '/api/library/fix-covers/cancel', FixCoversStatusSchema),

    // --- tags ---------------------------------------------------------------

    createTag: (name: string) => request('POST', '/api/tags', TagSchema, { name }),

    renameTag: (id: number, name: string) =>
      request('PATCH', `/api/tags/${id}`, TagSchema, { name }),

    setTagHue: (id: number, hue: number) => request('PATCH', `/api/tags/${id}`, TagSchema, { hue }),

    deleteTag: (id: number) => request('DELETE', `/api/tags/${id}`, OkSchema),

    bulkTag: (input: BulkTag) =>
      request('POST', '/api/tags/bulk', z.object({ affected: z.number() }), input),

    // --- playlists ----------------------------------------------------------

    createPlaylist: (input: CreatePlaylist) =>
      request('POST', '/api/playlists', PlaylistSchema, input),

    updatePlaylist: (id: number, patch: UpdatePlaylist) =>
      request('PATCH', `/api/playlists/${id}`, PlaylistSchema, patch),

    deletePlaylist: (id: number) => request('DELETE', `/api/playlists/${id}`, OkSchema),

    playlistSongs: (id: number) =>
      request('GET', `/api/playlists/${id}/songs`, PlaylistSongsSchema),

    addToPlaylist: (id: number, input: AddToPlaylist) =>
      request('POST', `/api/playlists/${id}/songs`, PlaylistSchema, input),

    removeFromPlaylist: (id: number, songId: number) =>
      request('DELETE', `/api/playlists/${id}/songs/${songId}`, PlaylistSchema),

    removeManyFromPlaylist: (id: number, songIds: number[]) =>
      request(
        'POST',
        `/api/playlists/${id}/songs/remove`,
        z.object({ removed: z.number(), playlist: PlaylistSchema.nullable() }),
        { songIds },
      ),

    reorderPlaylist: (id: number, songIds: number[]) =>
      request('PUT', `/api/playlists/${id}/order`, OkSchema, { songIds }),

    /** The playlist was started, for the playlists page's "Recently played" order. */
    markPlaylistPlayed: (id: number) => request('POST', `/api/playlists/${id}/played`, OkSchema),

    previewRules: (rules: SmartRules) =>
      request(
        'POST',
        '/api/playlists/preview',
        z.object({ songIds: z.array(z.number()), description: z.string() }),
        { rules },
      ),

    // --- import -------------------------------------------------------------

    importTools: (refresh = false) =>
      request(
        'GET',
        `/api/import/tools${refresh ? '?refresh=1' : ''}`,
        z.object({
          ytdlp: z.boolean(),
          ffmpeg: z.boolean(),
          ytdlpVersion: z.string().nullable(),
        }),
      ),

    importPreview: (url: string) =>
      request('POST', '/api/import/preview', ImportPreviewSchema, { url }),

    importEnqueue: (input: ImportEnqueue) =>
      request('POST', '/api/import/enqueue', ImportEnqueueResultSchema, input),

    importShare: (input: ImportShareRequest) =>
      request('POST', '/api/import/share', ImportShareResultSchema, input),

    ytCookieTest: () => request('POST', '/api/import/youtube/test', YtCookieTestSchema),

    importQueue: () => request('GET', '/api/import/queue', ImportQueueSchema),

    cancelImport: (id: string) => request('POST', `/api/import/jobs/${id}/cancel`, OkSchema),

    retryImport: (id: string) => request('POST', `/api/import/jobs/${id}/retry`, OkSchema),

    clearImports: () => request('POST', '/api/import/clear', z.object({ cleared: z.number() })),

    // --- migrate ------------------------------------------------------------

    migrateParse: (text: string) =>
      request('POST', '/api/migrate/parse', MigrateParseResultSchema, { text }),

    migrateMatch: (tracks: MigrateSourceTrack[]) =>
      request('POST', '/api/migrate/match', MigrateMatchJobSchema, { tracks }),

    migrateJob: (id: string) => request('GET', `/api/migrate/match/${id}`, MigrateMatchJobSchema),

    cancelMigrateJob: (id: string) => request('POST', `/api/migrate/match/${id}/cancel`, OkSchema),

    migrateEnqueue: (input: MigrateEnqueue) =>
      request('POST', '/api/migrate/enqueue', MigrateEnqueueResultSchema, input),

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

    /** Links asked of the Mac, through the bucket: the web app's own imports (lib/cloud). */
    cloudImports: () => request('GET', '/api/cloud/imports', ImportRequestListSchema),

    requestCloudImport: (input: CloudImportRequest) =>
      request('POST', '/api/cloud/imports', ImportRequestViewSchema, input),

    cancelCloudImport: (uid: string) => request('DELETE', `/api/cloud/imports/${uid}`, OkSchema),

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

    wrapped: (range: WrappedRange) =>
      request('GET', `/api/stats/wrapped?range=${range}`, WrappedSchema),

    gems: (limit = 20) => request('GET', `/api/library/gems?limit=${limit}`, ForgottenGemsSchema),

    history: (limit = 100) =>
      request(
        'GET',
        `/api/stats/history?limit=${limit}`,
        z.object({
          events: z.array(
            z.object({
              songId: z.number(),
              title: z.string(),
              artist: z.string(),
              hasArt: z.boolean(),
              playedAt: z.string(),
              completed: z.boolean(),
            }),
          ),
        }),
      ),
  }
}
