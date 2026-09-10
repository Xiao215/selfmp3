import {
  AnalysisStatusSchema,
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
  SecretsStatusSchema,
  TranslatedLyricsSchema,
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
  type AddToPlaylist,
  type ApplyMetadata,
  type BulkTag,
  type CreatePlaylist,
  type ImportEnqueue,
  type ImportShareRequest,
  type MigrateEnqueue,
  type MigrateSourceTrack,
  type PlayEvent,
  type SecretProvider,
  type SmartRules,
  type SongPatch,
  type StatsRange,
  type WrappedRange,
  type UpdatePlaylist,
  type UpdateSettings,
} from '@selfmp3/shared'
import { z } from 'zod'

/**
 * The typed API client.
 *
 * Every response is parsed with the same zod schema the server validated it
 * against, so a shape mismatch surfaces immediately and loudly instead of
 * becoming `undefined is not an object` inside a component. It costs a
 * millisecond per request and has repeatedly been worth it.
 */

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, message: string, code = 'error') {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }

  /** True when the request failed because the device is offline. */
  get isOffline(): boolean {
    return this.status === 0
  }
}

const ErrorResponseSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
})

/**
 * Generic over the *schema*, not over a bare `T`.
 *
 * Writing this as `schema: z.ZodType<T>` looks equivalent but is not: that
 * form is `ZodType<T, ZodTypeDef, T>`, so TypeScript can satisfy it by
 * inferring `T` from the schema's *input* type. Any schema using `.default()`
 * has an input type where those fields are optional, and the whole app then
 * ends up handling `Settings` and `SmartRules` values whose fields might be
 * undefined — which is exactly backwards, since the point of a default is that
 * the parsed output always has them.
 *
 * Constraining to `z.ZodTypeAny` and returning `z.output<S>` pins it to the
 * parsed side, which is the only side a caller ever sees.
 */
async function request<S extends z.ZodTypeAny>(
  method: string,
  path: string,
  schema: S,
  body?: unknown,
  init?: RequestInit,
): Promise<z.output<S>> {
  let response: Response
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      ...init,
    })
  } catch (error) {
    // A network-level failure is almost always "the Mac is asleep" rather than
    // a bug, so it gets its own status the UI can recognise.
    throw new ApiError(0, error instanceof Error ? error.message : 'network unavailable', 'offline')
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

export const api = {
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

  manifest: () => request('GET', '/api/library/manifest', SyncManifestSchema),

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

  recordSkip: (id: number, atSeconds: number) =>
    request('POST', `/api/songs/${id}/skipped`, OkSchema, { atSeconds }),

  lyrics: (id: number, refresh = false) =>
    request('GET', `/api/songs/${id}/lyrics${refresh ? '?refresh=1' : ''}`, LyricsResponseSchema),

  saveLyrics: (id: number, text: string) =>
    request('PUT', `/api/songs/${id}/lyrics`, OkSchema, { text }),

  // --- lyrics+ ------------------------------------------------------------

  romanizedLyrics: (id: number) =>
    request('GET', `/api/songs/${id}/lyrics/romanized`, RomanizedLyricsSchema),

  translatedLyrics: (id: number, lang: string) =>
    request(
      'GET',
      `/api/songs/${id}/lyrics/translation?lang=${encodeURIComponent(lang)}`,
      TranslatedLyricsSchema,
    ),

  lyricsSearch: (query: string, limit = 8) =>
    request(
      'GET',
      `/api/lyrics/search?q=${encodeURIComponent(query)}&limit=${limit}`,
      LyricsSearchResponseSchema,
    ),

  secrets: () => request('GET', '/api/settings/secrets', SecretsStatusSchema),

  setSecret: (provider: SecretProvider, key: string | null) =>
    request('PUT', '/api/settings/secrets', SecretsStatusSchema, { provider, key }),
  similar: (id: number, limit = 20) =>
    request('GET', `/api/songs/${id}/similar?limit=${limit}`, SimilarSongsSchema),

  deleteSong: (id: number, deleteFile: boolean) =>
    request('DELETE', `/api/songs/${id}?deleteFile=${deleteFile ? 1 : 0}`, OkSchema),

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

  renameTag: (id: number, name: string) => request('PATCH', `/api/tags/${id}`, TagSchema, { name }),

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

  playlistSongs: (id: number) => request('GET', `/api/playlists/${id}/songs`, PlaylistSongsSchema),

  addToPlaylist: (id: number, input: AddToPlaylist) =>
    request('POST', `/api/playlists/${id}/songs`, PlaylistSchema, input),

  removeFromPlaylist: (id: number, songId: number) =>
    request('DELETE', `/api/playlists/${id}/songs/${songId}`, PlaylistSchema),

  reorderPlaylist: (id: number, songIds: number[]) =>
    request('PUT', `/api/playlists/${id}/order`, OkSchema, { songIds }),

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

/** URLs for media. Kept here so nothing else has to know the route shape. */
export const mediaUrl = {
  stream: (songId: number) => `/api/stream/${songId}`,
  art: (songId: number) => `/api/art/${songId}`,
}
