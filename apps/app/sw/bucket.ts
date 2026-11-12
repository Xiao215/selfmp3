/// <reference lib="webworker" />

/**
 * The bucket, for the web build: a song's or a cover's file fetched through
 * the doorman, for a tab signed in to the cloud.
 *
 * Where the app keeps the doorman session and each song's files: IndexedDB
 * (`DB_NAME` in ./names.ts), under the keys packages/replica writes them with
 * (`CLOUD_SESSION_KEY`, `CLOUD_FILES_KEY` in packages/shared).
 */

import {
  BUCKET_CAP_CODE,
  BUCKET_HOLD_MS,
  CLOUD_FILES_KEY,
  CLOUD_SESSION_KEY,
  DOORMAN_PATHS,
  HASH_FILE_NAME,
  UNANSWERED_HEADER,
  UNANSWERED_TEXT,
  parseDoormanRefusal,
} from '@selfmp3/shared/wire'
import { API_CACHE, DB_NAME, DB_STORE, DB_VERSION, SW_MESSAGE } from './names'

declare const self: ServiceWorkerGlobalScope

/** Registered as `sw.js?cloud=1` when signed in to the cloud (src/ports/serviceWorker.web.ts): only then is there a bucket to ask. */
const CLOUD = new URL(self.location.href).searchParams.get('cloud') === '1'

export interface BucketFile {
  /** `audio/<sha256>.m4a`: the bytes, for good. */
  readonly key: string
  readonly url: string
  readonly token: string
}

/** How often, and how far apart, the map is read again for a key that does not match its address. */
const MAP_REREADS = 3
const MAP_REREAD_MS = 400

/**
 * The bucket file behind a stream or cover URL, when the app is signed in to
 * the doorman — which only the web build is. Null otherwise: served by the
 * server, nothing here changes.
 *
 * The address itself says which file it means. A library read from the
 * bucket gives a song's `rev` as `<audio hash>.<cover hash>`, the first twelve
 * characters of each file's hash-named key (packages/replica/src/
 * snapshotLibrary.ts, `hashOf`), and the page sends it as `?v=`. The map of
 * songs to keys read here is only the way from that to the whole key, and it
 * can lag: the page writes it to IndexedDB after it has drawn the library,
 * and the copy kept here is trusted for a few seconds. When a cover changed,
 * a row asking for the new address inside that lag would be answered with the
 * old file, and the cache would keep that answer under the new address for
 * good — one song wearing another's cover. So a key that does not
 * name what the address names is read again, a little later, a few times;
 * one that still does not is no answer at all, and nothing is stored.
 */
export async function bucketFileFor(url: URL, kind: 'audio' | 'cover'): Promise<BucketFile | null> {
  if (!CLOUD) return null
  const match = /\/api\/(?:stream|art)\/(\d+)$/.exec(url.pathname)
  const songId = match?.[1]
  if (!songId) return null
  const wanted = keyHashIn(url, kind)
  try {
    let read = await bucketRead(false)
    // A song added a moment ago, or a session just made: not a miss yet.
    if (!read.fresh && (!read.session || read.files?.[songId] === undefined)) {
      read = await bucketRead(true)
    }
    let key = read.files?.[songId]?.[kind]
    for (let attempt = 0; wanted !== null && !names(key, wanted); attempt++) {
      if (attempt === MAP_REREADS) return null
      if (attempt > 0 || read.fresh) await pause(MAP_REREAD_MS)
      read = await bucketRead(true)
      key = read.files?.[songId]?.[kind]
    }
    if (!read.session || typeof key !== 'string') return null
    return {
      key,
      url: `${read.session.doormanUrl}${DOORMAN_PATHS.file(key)}`,
      token: read.session.token,
    }
  } catch {
    return null
  }
}

/** Where a bucket picture is kept by its key: the address `bucketPicture` answers. */
export function bucketAddress(key: string): string {
  return new URL(`api/bucket/${key}`, self.registration.scope).href
}

/** `api/bucket/covers/<sha256>.<ext>`: the only bucket files asked for by key. */
const BUCKET_PICTURE_PATH = new RegExp(`/api/bucket/(covers/${HASH_FILE_NAME})$`)

/**
 * A bucket picture no song id names — an artist's — by its key
 * (src/ports/bucketMedia.web.ts, `bucketPictureAddress`). The key is the hash
 * of the bytes, so what is kept under it is right for good, and there is no
 * map to look it up in, nor one to lag.
 */
export async function bucketPicture(request: Request, url: URL): Promise<Response> {
  const cached = await caches.match(request)
  if (cached) return cached
  const key = BUCKET_PICTURE_PATH.exec(url.pathname)?.[1]
  if (!CLOUD || !key) return new Response(null, { status: 404 })
  try {
    let read = await bucketRead(false)
    if (!read.session && !read.fresh) read = await bucketRead(true)
    if (!read.session) return new Response(null, { status: 404 })
    const response = await fetchFromBucket({
      key,
      url: `${read.session.doormanUrl}${DOORMAN_PATHS.file(key)}`,
      token: read.session.token,
    })
    if (response.ok) await (await caches.open(API_CACHE)).put(request, response.clone())
    return response
  } catch {
    return new Response(null, { status: 503 })
  }
}

/**
 * The twelve hex characters the address's `?v=` gives for `kind`'s key, or
 * null for an address that names no key: a song with no cover (`0` there),
 * or a server's addresses, whose `rev` is the file's size, mtime and art
 * revision in base 36 and never twelve hex characters.
 */
function keyHashIn(url: URL, kind: 'audio' | 'cover'): string | null {
  const rev = url.searchParams.get('v')
  if (!rev) return null
  const [audio = '', cover = ''] = rev.split('.')
  const half = kind === 'audio' ? audio : cover
  return /^[0-9a-f]{12}$/.test(half) ? half : null
}

/** Whether a bucket key is the file an address's hash names. */
function names(key: unknown, hash: string): boolean {
  return typeof key === 'string' && key.includes(`/${hash}`)
}

function pause(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * How long the session and the song files read from IndexedDB are trusted.
 *
 * Every range the player asks for, and every cover, comes through
 * bucketFileFor, which otherwise opens the database twice and copies the whole
 * library's file map out of it per request, all through a song. Kept this
 * long, a file changed on another device or a token renewed is picked up
 * within seconds; an id not in the map at all is read again at once.
 */
const BUCKET_READ_MS = 5_000

interface BucketRead {
  readonly session: { doormanUrl: string; token: string } | null
  readonly files: Record<string, { audio?: unknown; cover?: unknown } | undefined> | null
  readonly at: number
}

let lastBucketRead: BucketRead | null = null

async function bucketRead(force: boolean): Promise<BucketRead & { fresh: boolean }> {
  const kept = lastBucketRead
  if (!force && kept && Date.now() - kept.at < BUCKET_READ_MS) return { ...kept, fresh: false }
  const [session, files] = await readStored([CLOUD_SESSION_KEY, CLOUD_FILES_KEY])
  const stored = session as { doormanUrl?: unknown; token?: unknown } | null
  lastBucketRead = {
    session:
      typeof stored?.doormanUrl === 'string' && typeof stored.token === 'string'
        ? { doormanUrl: stored.doormanUrl, token: stored.token }
        : null,
    files: typeof files === 'object' && files !== null ? (files as BucketRead['files']) : null,
    at: Date.now(),
  }
  return { ...lastBucketRead, fresh: true }
}

/**
 * The bucket refusing for the day (docs/SYNC.md, "Caps").
 *
 * Backblaze stops answering once a day's reads pass the account's cap, and the
 * doorman says so as a 502 with this code. Nothing this worker is asked for
 * will be answered until the cap is raised or the day turns, so for a while
 * the bucket is not asked: every cover a row draws and every range a player
 * wants is answered with the doorman's own refusal, from here. For as long as
 * the page's own hold lasts (`BUCKET_HOLD_MS`), then one more real request
 * finds out whether it is over — a cap raised at backblaze.com should not
 * have to wait for midnight to be noticed. The page is told
 * (`SW_MESSAGE.bucketCapped`, src/ports/serviceWorker.web.ts), so its own
 * reads — the snapshot, the words — stop too, and it can say why.
 *
 * In memory only: this worker is stopped when idle, and a wake costs one
 * refused request to learn it again, which is fine.
 */
let capped: { readonly until: number; readonly body: string } | null = null

/** The doorman's refusal, as the message the page shows and the body a player is answered with. */
function capMessage(body: string): string | null {
  const refusal = parseDoormanRefusal(body)
  return refusal?.code === BUCKET_CAP_CODE ? refusal.error : null
}

/** The cap raised at backblaze.com, says the person: the bucket is asked again. */
export function releaseBucket(): void {
  capped = null
}

function refused(body: string): Response {
  return new Response(body, {
    status: 502,
    statusText: 'Bad Gateway',
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

async function holdBucket(body: string, message: string): Promise<void> {
  capped = { until: Date.now() + BUCKET_HOLD_MS, body }
  const clients = await self.clients.matchAll({ type: 'window' })
  for (const client of clients) client.postMessage({ type: SW_MESSAGE.bucketCapped, message })
}

/**
 * A file from the bucket, as a plain same-origin response.
 *
 * A range asked for here is asked of the bucket too, and its answer — a 206,
 * a `content-range` — comes back as it is, so a song plays and seeks while it
 * arrives instead of after it. The bytes are passed straight on: the doorman
 * never holds a body whole, and neither does this.
 */
export async function fetchFromBucket(file: BucketFile, range?: string | null): Promise<Response> {
  if (capped !== null) {
    if (Date.now() < capped.until) return refused(capped.body)
    capped = null
  }
  try {
    const ask = new Headers({ Authorization: `Bearer ${file.token}` })
    if (range) ask.set('range', range)
    const response = await fetch(file.url, { headers: ask })
    if (response.status === 502) {
      // The doorman's refusals are small JSON; a cap is the one worth holding.
      const body = await response.clone().text()
      const message = capMessage(body)
      if (message !== null) await holdBucket(body, message)
    }
    const headers = new Headers()
    for (const name of [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'etag',
    ]) {
      const value = response.headers.get(name)
      if (value) headers.set(name, value)
    }
    // A whole file is the one the hash names, forever. A slice of one is the
    // player's business for as long as it is playing, and no cache's; nor is
    // a refusal.
    headers.set(
      'Cache-Control',
      response.status === 206 || !response.ok ? 'no-store' : 'private, max-age=31536000, immutable',
    )
    return new Response(response.body, { status: response.status, headers })
  } catch {
    return new Response(UNANSWERED_TEXT, {
      status: 503,
      statusText: 'Offline',
      headers: { 'Content-Type': 'text/plain', [UNANSWERED_HEADER]: '1' },
    })
  }
}

/** Several keys, in one opening of the database and one transaction. */
function readStored(keys: readonly string[]): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION)
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(DB_STORE)) open.result.createObjectStore(DB_STORE)
    }
    open.onerror = () => reject(open.error ?? new Error('could not open IndexedDB'))
    // Another tab holding an older version open keeps this one waiting: an
    // answer, not a hang.
    open.onblocked = () => reject(new Error('IndexedDB is open elsewhere at an older version'))
    open.onsuccess = () => {
      const db = open.result
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.close()
        resolve(keys.map(() => null))
        return
      }
      const transaction = db.transaction(DB_STORE, 'readonly')
      const store = transaction.objectStore(DB_STORE)
      const requests = keys.map(key => store.get(key))
      transaction.oncomplete = () => {
        db.close()
        resolve(requests.map(request => (request.result as unknown) ?? null))
      }
      // A transaction that errors or is aborted settles here too; left
      // unhandled, the promise would wait forever.
      const failed = (fallback: string) => () => {
        db.close()
        reject(transaction.error ?? new Error(fallback))
      }
      transaction.onerror = failed('IndexedDB read failed')
      transaction.onabort = failed('IndexedDB read aborted')
    }
  })
}
