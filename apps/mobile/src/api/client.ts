import {
  HealthSchema,
  LibrarySchema,
  LyricsResponseSchema,
  PlaylistSongsSchema,
  RomanizedLyricsSchema,
  SettingsSchema,
  SimilarSongsSchema,
  SongSchema,
  SyncManifestSchema,
  type PlayEvent,
} from '@selfmp3/shared'
import { z } from 'zod'
import type { ServerConnection } from '../server/connection'

/**
 * The typed API client, same shape as the web app's `lib/api.ts`.
 *
 * Responses are parsed with the shared zod schemas the server validated them
 * against, so a contract mismatch is an immediate, named error rather than an
 * `undefined is not an object` three screens later. The one difference from
 * the web client is that every call takes a `ServerConnection`: the phone
 * talks to an absolute origin it was told about at onboarding, not to its own
 * page origin.
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

  /** True when the request never reached the server — asleep Mac, no VPN. */
  get isOffline(): boolean {
    return this.status === 0
  }
}

const ErrorResponseSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
})

const OkSchema = z.object({ ok: z.literal(true) }).passthrough()

/** A slow request is almost always a sleeping server; do not hang forever. */
const REQUEST_TIMEOUT_MS = 15_000

function authHeaders(connection: ServerConnection): Record<string, string> {
  return connection.token ? { Authorization: `Bearer ${connection.token}` } : {}
}

/**
 * Generic over the schema rather than a bare `T`, for the same reason as the
 * web client: `z.ZodType<T>` lets TypeScript infer `T` from the schema's
 * *input* type, so anything using `.default()` would be typed as if the
 * defaults might be missing. `z.output<S>` pins it to the parsed side.
 */
async function request<S extends z.ZodTypeAny>(
  connection: ServerConnection,
  method: string,
  path: string,
  schema: S,
  body?: unknown,
): Promise<z.output<S>> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(`${connection.baseUrl}${path}`, {
      method,
      headers: {
        ...authHeaders(connection),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (error) {
    throw new ApiError(0, error instanceof Error ? error.message : 'network unavailable', 'offline')
  } finally {
    clearTimeout(timeout)
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
    throw new ApiError(
      500,
      `Unexpected response from ${path}: ${parsed.error.issues[0]?.message ?? 'shape mismatch'}`,
      'contract_mismatch',
    )
  }
  return parsed.data as z.output<S>
}

export const api = {
  // --- library ------------------------------------------------------------

  library: (connection: ServerConnection) => request(connection, 'GET', '/api/library', LibrarySchema),

  libraryVersion: (connection: ServerConnection) =>
    request(
      connection,
      'GET',
      '/api/library/version',
      z.object({ version: z.number(), songCount: z.number() }),
    ),

  /** Sizes and etags for every song — what the download screen budgets from. */
  manifest: (connection: ServerConnection) =>
    request(connection, 'GET', '/api/library/manifest', SyncManifestSchema),

  playlistSongs: (connection: ServerConnection, id: number) =>
    request(connection, 'GET', `/api/playlists/${id}/songs`, PlaylistSongsSchema),

  similar: (connection: ServerConnection, id: number, limit = 20) =>
    request(connection, 'GET', `/api/songs/${id}/similar?limit=${limit}`, SimilarSongsSchema),

  // --- playback reporting -------------------------------------------------

  recordPlay: (connection: ServerConnection, id: number, event: PlayEvent) =>
    request(connection, 'POST', `/api/songs/${id}/played`, OkSchema, event),

  recordSkip: (connection: ServerConnection, id: number, atSeconds: number, clientId?: string) =>
    request(connection, 'POST', `/api/songs/${id}/skipped`, OkSchema, { atSeconds, clientId }),

  setLoved: (connection: ServerConnection, id: number, loved: boolean) =>
    request(connection, 'POST', `/api/songs/${id}/loved`, SongSchema, { loved }),

  // --- lyrics -------------------------------------------------------------

  lyrics: (connection: ServerConnection, id: number, refresh = false) =>
    request(
      connection,
      'GET',
      `/api/songs/${id}/lyrics${refresh ? '?refresh=1' : ''}`,
      LyricsResponseSchema,
    ),

  romanizedLyrics: (connection: ServerConnection, id: number) =>
    request(connection, 'GET', `/api/songs/${id}/lyrics/romanized`, RomanizedLyricsSchema),

  // --- system -------------------------------------------------------------

  /**
   * Also the connection test on the onboarding screen: `/api/health` is the
   * one route that stays open when a bearer token is configured, so a 200 here
   * proves the address is right even if the token is wrong.
   */
  health: (connection: ServerConnection) => request(connection, 'GET', '/api/health', HealthSchema),

  settings: (connection: ServerConnection) =>
    request(connection, 'GET', '/api/settings', SettingsSchema),
}

/**
 * URLs for media.
 *
 * The token goes in the query string rather than a header because these URLs
 * are handed to the native audio player and to CarPlay's image loader, neither
 * of which lets us attach headers. The server accepts it there for exactly
 * this reason (see `bearerAuth` in apps/server/src/http/middleware.ts).
 *
 * Pass the song's `rev` when it is known: song ids get reused, and an image or
 * audio cache keyed on the bare URL would keep serving the old song's file.
 */
export const mediaUrl = {
  stream: (connection: ServerConnection, songId: number, rev?: string) =>
    withQuery(`${connection.baseUrl}/api/stream/${songId}`, connection.token, rev),
  art: (connection: ServerConnection, songId: number, rev?: string) =>
    withQuery(`${connection.baseUrl}/api/art/${songId}`, connection.token, rev),
}

function withQuery(url: string, token: string | null, rev: string | undefined): string {
  const params: string[] = []
  if (rev) params.push(`v=${encodeURIComponent(rev)}`)
  if (token) params.push(`token=${encodeURIComponent(token)}`)
  return params.length > 0 ? `${url}?${params.join('&')}` : url
}
