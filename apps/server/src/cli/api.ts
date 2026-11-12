import type { z } from 'zod'
import {
  DEFAULT_LOCAL_SERVER_URL,
  HUB_LIBRARY_HEADER,
  HealthSchema,
  HubStatusSchema,
  type Health,
  type HubStatus,
} from '@selfmp3/shared'

/**
 * The thinnest possible client for the running server. The CLI never touches
 * the database directly: everything goes through the same API the web app
 * uses, so there is exactly one code path for scanning, importing and tagging.
 */

export interface ServerClient {
  readonly baseUrl: string
  health(): Promise<Health | null>
  /** Whom the server works for; null when it will not say (asked from another computer). */
  hub(): Promise<HubStatus | null>
  /** A POST, its answer read through `schema`. */
  post<S extends z.ZodTypeAny>(route: string, schema: S, body?: unknown): Promise<z.output<S>>
}

/** Which library requests go to: by its token, or, from this computer, by its id. */
export interface LibraryChoice {
  readonly token: string | null
  readonly library: string | null
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export function createClient(
  baseUrl: string,
  { token, library }: LibraryChoice = { token: null, library: null },
): ServerClient {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token) headers['authorization'] = `Bearer ${token}`
  else if (library) headers[HUB_LIBRARY_HEADER] = library

  const request = async (method: string, route: string, body?: unknown): Promise<unknown> => {
    const response = await fetch(`${baseUrl}/api${route}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const payload: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      const message =
        payload && typeof payload === 'object' && 'error' in payload
          ? String(payload.error)
          : response.statusText
      throw new ApiError(response.status, message)
    }
    return payload
  }

  return {
    baseUrl,
    async health() {
      try {
        return HealthSchema.parse(await request('GET', '/health'))
      } catch {
        return null
      }
    },
    async hub() {
      try {
        return HubStatusSchema.parse(await request('GET', '/hub'))
      } catch (error) {
        if (error instanceof ApiError && error.status === 403) return null
        throw error
      }
    },
    post: async (route, schema, body) =>
      schema.parse(await request('POST', route, body)) as z.output<typeof schema>,
  }
}

/** Where a server started from this checkout would be listening. */
export function defaultBaseUrl(): string {
  const port = process.env['SELFMP3_PORT']
  return port ? `http://localhost:${port}` : DEFAULT_LOCAL_SERVER_URL
}
