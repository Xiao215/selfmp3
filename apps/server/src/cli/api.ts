import type { Health } from '@selfmp3/shared'

/**
 * The thinnest possible client for the running server. The CLI never touches
 * the database directly: everything goes through the same API the web app
 * uses, so there is exactly one code path for scanning, importing and tagging.
 */

export interface ServerClient {
  readonly baseUrl: string
  health(): Promise<Health | null>
  post<T>(route: string, body?: unknown): Promise<T>
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export function createClient(baseUrl: string, token: string | null): ServerClient {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token) headers['authorization'] = `Bearer ${token}`

  const request = async <T>(method: string, route: string, body?: unknown): Promise<T> => {
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
    return payload as T
  }

  return {
    baseUrl,
    async health() {
      try {
        return await request<Health>('GET', '/health')
      } catch {
        return null
      }
    },
    post: (route, body) => request('POST', route, body),
  }
}

/** Where a server started from this checkout would be listening. */
export function defaultBaseUrl(): string {
  const port = process.env['SELFMP3_PORT'] ?? '4600'
  return `http://localhost:${port}`
}
