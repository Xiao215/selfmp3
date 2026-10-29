import { Readable } from 'node:stream'
import {
  CHANGES_HEADER,
  DOORMAN_ERROR,
  DOORMAN_PATHS,
  DoormanChangesSchema,
  DoormanClaimResultSchema,
  DoormanError,
  DoormanGrantMadeSchema,
  DoormanListSchema,
  DoormanMeSchema,
  doormanRequest,
  parseChangesHeader,
  type CloudConnect,
  type DoormanCall,
  type DoormanClaimResult,
  type DoormanErrorCode,
  type DoormanGrantMade,
  type DoormanGrantRequest,
  type DoormanMe,
  type DoormanRequest,
} from '@selfmp3/shared'
import {
  CloudError,
  hostOf,
  type CloudObject,
  type CloudPutOptions,
  type CloudStore,
} from './store.js'

/**
 * Talking to the doorman (docs/SYNC.md; the Worker is apps/doorman).
 *
 * The doorman signs this server in with your Google account and keeps the bucket
 * that belongs to it. Once signed in, the server holds only a session — never the
 * bucket's key — and every read and write goes through the doorman, which
 * checks the session and passes it on to the bucket.
 *
 * The requests themselves are packages/shared's `doormanRequest`, the one every
 * device uses too; what is this server's own is turning a refusal into a
 * `CloudError` the sync knows what to do with.
 */

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

interface RequestOptions extends Omit<DoormanCall<AbortSignal>, 'method' | 'body'> {
  readonly body?: Buffer
}

/**
 * What the sync does about each refusal it can act on. Everything else is
 * `other`, in the doorman's own words. A bucket that refused its key is not
 * this server's session to end, so `bucket_refused_key` is not `auth`.
 */
const KIND_OF: Partial<Record<DoormanErrorCode, CloudError['kind']>> = {
  [DOORMAN_ERROR.unauthorized]: 'auth',
  [DOORMAN_ERROR.noStorage]: 'missing',
  [DOORMAN_ERROR.noSuchBucket]: 'missing',
  [DOORMAN_ERROR.bucketUnreachable]: 'network',
  // The doorman's own word for a used-up cap, so a pass stops at the first
  // refusal rather than trying every song against it.
  [DOORMAN_ERROR.bucketCapExceeded]: 'cap',
  [DOORMAN_ERROR.bucketBusy]: 'busy',
}

/** The few refusals said here in words of this server's, because what to do is done here. */
const WORDS: Partial<Record<DoormanErrorCode, string>> = {
  [DOORMAN_ERROR.unauthorized]:
    'Your Google sign-in has expired or was signed out. Sign in again in Settings → Cloud.',
  [DOORMAN_ERROR.noStorage]: 'No bucket is connected to this Google account yet.',
  [DOORMAN_ERROR.tooManyGrants]:
    'This Google account already lets as many servers in as it can. Remove one under ' +
    'Settings → Cloud on one of your devices, then try again.',
}

export class DoormanClient {
  readonly url: string
  readonly #send: DoormanRequest<Response, AbortSignal>

  constructor(url: string, fetchImpl: FetchLike = (input, init) => fetch(input, init)) {
    this.url = url.replace(/\/+$/, '')
    this.#send = doormanRequest<Response, AbortSignal>(this.url, fetchImpl)
  }

  /**
   * How a sign-in stands, or with the code the doorman showed, the session.
   * A wrong code throws, and the doorman forgets the attempt.
   */
  async claim(attempt: string, code?: string): Promise<DoormanClaimResult> {
    const response = await this.request('POST', DOORMAN_PATHS.claim, {
      json: code === undefined ? { attempt } : { attempt, code },
    })
    return DoormanClaimResultSchema.parse(await response.json())
  }

  async me(token: string): Promise<DoormanMe> {
    const response = await this.request('GET', DOORMAN_PATHS.me, { token })
    return DoormanMeSchema.parse(await response.json())
  }

  /** Connect a bucket to the signed-in Google account. The doorman tests it first. */
  async connectStorage(token: string, input: CloudConnect): Promise<DoormanMe> {
    const response = await this.request('PUT', DOORMAN_PATHS.storage, { token, json: input })
    return DoormanMeSchema.parse(await response.json())
  }

  async signOut(token: string): Promise<void> {
    await this.request('POST', DOORMAN_PATHS.signOut, { token })
  }

  /**
   * A grant for this server, made with the session a device handed it
   * (docs/features/shared-server.md): a session of the server's own for that
   * account, which lasts until the account takes it back.
   */
  async grant(token: string, request: DoormanGrantRequest): Promise<DoormanGrantMade> {
    const response = await this.request('POST', DOORMAN_PATHS.grants, { token, json: request })
    return DoormanGrantMadeSchema.parse(await response.json())
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
    const { body, ...call } = options
    try {
      return await this.#send(path, {
        ...call,
        method,
        ...(body ? { body: new Uint8Array(body.buffer, body.byteOffset, body.length) } : {}),
      })
    } catch (error) {
      throw error instanceof DoormanError ? this.#cloudError(error) : error
    }
  }

  #cloudError(error: DoormanError): CloudError {
    if (error.code === DOORMAN_ERROR.unreachable) {
      return new CloudError(
        'network',
        `Could not reach the doorman at ${hostOf(this.url)} (${error.message}).`,
      )
    }
    return new CloudError(KIND_OF[error.code] ?? 'other', WORDS[error.code] ?? error.message)
  }
}

/** The bucket, through the doorman. Keys are relative to the bucket's folder, as ever. */
class DoormanCloudStore implements CloudStore {
  readonly description: string
  readonly #doorman: DoormanClient
  readonly #token: string
  /**
   * Each move of the change counter this server's own writes made, from
   * where it stood to where it went: what `followOwn` walks. A few dozen
   * kept; a chain that runs off the end only means one listing more.
   */
  readonly #ownMoves = new Map<string, string>()

  constructor(doorman: DoormanClient, token: string, description: string) {
    this.#doorman = doorman
    this.#token = token
    this.description = description
  }

  async head(key: string): Promise<CloudObject | null> {
    const response = await this.#doorman.request('HEAD', DOORMAN_PATHS.file(key), {
      token: this.#token,
      allowStatus: [404],
    })
    if (response.status === 404) return null
    return { key, size: Number(response.headers.get('content-length') ?? 0) }
  }

  async get(key: string): Promise<Buffer | null> {
    const response = await this.#doorman.request('GET', DOORMAN_PATHS.file(key), {
      token: this.#token,
      allowStatus: [404],
    })
    if (response.status === 404) return null
    return Buffer.from(await response.arrayBuffer())
  }

  async range(
    key: string,
    start: number,
    end: number,
    signal?: AbortSignal,
  ): Promise<NodeJS.ReadableStream | null> {
    // The doorman passes `Range` straight to the bucket and its 206 straight
    // back (docs/SYNC.md), which is how every browser tab streams already.
    const response = await this.#doorman.request('GET', DOORMAN_PATHS.file(key), {
      token: this.#token,
      allowStatus: [404],
      headers: { Range: `bytes=${start}-${end}` },
      signal,
    })
    if (response.status === 404) return null
    if (!response.body) return Readable.from([Buffer.from(await response.arrayBuffer())])
    return Readable.fromWeb(response.body)
  }

  async put(key: string, body: Buffer, options: CloudPutOptions): Promise<void> {
    const response = await this.#doorman.request('PUT', DOORMAN_PATHS.file(key), {
      token: this.#token,
      body,
      headers: {
        'Content-Type': options.contentType,
        ...(options.contentEncoding ? { 'Content-Encoding': options.contentEncoding } : {}),
      },
    })
    this.#noteOwnMove(response)
  }

  async list(prefix: string): Promise<CloudObject[]> {
    const objects: CloudObject[] = []
    let cursor: string | null = null
    do {
      const response = await this.#doorman.request('GET', DOORMAN_PATHS.listing(prefix, cursor), {
        token: this.#token,
      })
      const page = DoormanListSchema.parse(await response.json())
      objects.push(...page.objects)
      cursor = page.cursor
    } while (cursor)
    return objects
  }

  async delete(key: string): Promise<void> {
    const response = await this.#doorman.request('DELETE', DOORMAN_PATHS.file(key), {
      token: this.#token,
      allowStatus: [404],
    })
    this.#noteOwnMove(response)
  }

  async changes(): Promise<string | null> {
    // A 404 is a doorman deployed without a counter: list, then.
    const response = await this.#doorman.request('GET', DOORMAN_PATHS.changes, {
      token: this.#token,
      allowStatus: [404],
    })
    if (response.status === 404) {
      await response.body?.cancel()
      return null
    }
    return DoormanChangesSchema.parse(await response.json()).changes
  }

  followOwn(held: string): string {
    let at = held
    for (let steps = 0; steps < OWN_MOVES_KEPT; steps++) {
      const next = this.#ownMoves.get(at)
      if (next === undefined) break
      at = next
    }
    return at
  }

  #noteOwnMove(response: Response): void {
    const moved = parseChangesHeader(response.headers.get(CHANGES_HEADER))
    if (!moved) return
    if (this.#ownMoves.size >= OWN_MOVES_KEPT) this.#ownMoves.clear()
    this.#ownMoves.set(moved.before, moved.after)
  }
}

/** How many of its own counter moves the doorman store remembers. */
const OWN_MOVES_KEPT = 64
