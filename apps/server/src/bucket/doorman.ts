import {
  DoormanClaimResultSchema,
  DoormanListSchema,
  DoormanMeSchema,
  ErrorBodySchema,
  type CloudConnect,
  type DoormanClaimResult,
  type DoormanMe,
} from '@selfmp3/shared'
import { CloudError, type CloudObject, type CloudPutOptions, type CloudStore } from './store.js'

/**
 * Talking to the doorman (docs/SYNC.md; the Worker is apps/doorman).
 *
 * The doorman signs this server in with your Google account and keeps the bucket
 * that belongs to it. Once signed in, the server holds only a session — never the
 * bucket's key — and every read and write goes through the doorman, which
 * checks the session and passes it on to the bucket.
 */

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

interface RequestOptions {
  readonly token?: string
  readonly json?: unknown
  readonly body?: Buffer
  readonly headers?: Record<string, string>
  /** Hand a 404 back to the caller instead of throwing: "no such file" is an answer. */
  readonly allow404?: boolean
}

export class DoormanClient {
  readonly url: string
  readonly #fetch: FetchLike

  constructor(url: string, fetchImpl: FetchLike = (input, init) => fetch(input, init)) {
    this.url = url.replace(/\/+$/, '')
    this.#fetch = fetchImpl
  }

  /**
   * How a sign-in stands, or with the code the doorman showed, the session.
   * A wrong code throws, and the doorman forgets the attempt.
   */
  async claim(attempt: string, code?: string): Promise<DoormanClaimResult> {
    const response = await this.request('POST', '/v1/auth/claim', {
      json: code === undefined ? { attempt } : { attempt, code },
    })
    return DoormanClaimResultSchema.parse(await response.json())
  }

  async me(token: string): Promise<DoormanMe> {
    const response = await this.request('GET', '/v1/me', { token })
    return DoormanMeSchema.parse(await response.json())
  }

  /** Connect a bucket to the signed-in Google account. The doorman tests it first. */
  async connectStorage(token: string, input: CloudConnect): Promise<DoormanMe> {
    const response = await this.request('PUT', '/v1/storage', { token, json: input })
    return DoormanMeSchema.parse(await response.json())
  }

  async signOut(token: string): Promise<void> {
    await this.request('POST', '/v1/auth/signout', { token })
  }

  /** The signed-in account's bucket, as the sync sees any bucket. */
  store(token: string, description: string): CloudStore {
    return new DoormanCloudStore(this, token, description)
  }

  /**
   * One request, with the doorman's answers turned into errors that say what
   * to do: sign in again, connect a bucket, or check the connection.
   */
  async request(method: string, path: string, options: RequestOptions = {}): Promise<Response> {
    const headers: Record<string, string> = { ...options.headers }
    if (options.token) headers['Authorization'] = `Bearer ${options.token}`
    let body: string | Uint8Array | undefined
    if (options.json !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(options.json)
    } else if (options.body) {
      headers['Content-Length'] = String(options.body.length)
      body = new Uint8Array(options.body.buffer, options.body.byteOffset, options.body.length)
    }

    let response: Response
    try {
      response = await this.#fetch(`${this.url}${path}`, { method, headers, body })
    } catch {
      throw new CloudError('network', `Could not reach the doorman at ${hostOf(this.url)}.`)
    }

    if (response.ok || (options.allow404 && response.status === 404)) return response

    const parsed = ErrorBodySchema.safeParse(await response.json().catch(() => null))
    const message = parsed.success ? parsed.data.error : `the doorman answered ${response.status}`
    if (response.status === 401) {
      throw new CloudError(
        'auth',
        'Your Google sign-in has expired or was signed out. Sign in again in Settings → Cloud.',
      )
    }
    if (response.status === 409) {
      throw new CloudError('missing', 'No bucket is connected to this Google account yet.')
    }
    throw new CloudError('other', message)
  }
}

/** The bucket, through the doorman. Keys are relative to the bucket's folder, as ever. */
class DoormanCloudStore implements CloudStore {
  readonly description: string
  readonly #doorman: DoormanClient
  readonly #token: string

  constructor(doorman: DoormanClient, token: string, description: string) {
    this.#doorman = doorman
    this.#token = token
    this.description = description
  }

  async head(key: string): Promise<CloudObject | null> {
    const response = await this.#doorman.request('HEAD', filePath(key), {
      token: this.#token,
      allow404: true,
    })
    if (response.status === 404) return null
    return { key, size: Number(response.headers.get('content-length') ?? 0) }
  }

  async get(key: string): Promise<Buffer | null> {
    const response = await this.#doorman.request('GET', filePath(key), {
      token: this.#token,
      allow404: true,
    })
    if (response.status === 404) return null
    return Buffer.from(await response.arrayBuffer())
  }

  async put(key: string, body: Buffer, options: CloudPutOptions): Promise<void> {
    await this.#doorman.request('PUT', filePath(key), {
      token: this.#token,
      body,
      headers: {
        'Content-Type': options.contentType,
        ...(options.contentEncoding ? { 'Content-Encoding': options.contentEncoding } : {}),
      },
    })
  }

  async list(prefix: string): Promise<CloudObject[]> {
    const objects: CloudObject[] = []
    let cursor: string | null = null
    do {
      const params = new URLSearchParams({ prefix })
      if (cursor) params.set('cursor', cursor)
      const response = await this.#doorman.request('GET', `/v1/list?${params.toString()}`, {
        token: this.#token,
      })
      const page = DoormanListSchema.parse(await response.json())
      objects.push(...page.objects)
      cursor = page.cursor
    } while (cursor)
    return objects
  }

  async delete(key: string): Promise<void> {
    await this.#doorman.request('DELETE', filePath(key), { token: this.#token, allow404: true })
  }
}

/** Each part of the key encoded on its own, so the slashes stay slashes. */
function filePath(key: string): string {
  return `/v1/files/${key.split('/').map(encodeURIComponent).join('/')}`
}

function hostOf(url: string): string {
  return url.replace(/^https?:\/\//, '')
}
