/// <reference lib="webworker" />

/**
 * Songs: a download kept on this device, answered a range at a time, or a
 * cloud song played from one download of it out of the bucket (sw.ts, job 2).
 */

import {
  PLAYED_KEPT,
  REFRESH_HEADER,
  WAIT_AHEAD_BYTES,
  parseRange,
  relayedRange,
} from '@selfmp3/shared/wire'
import { AUDIO_CACHE, PLAYED_CACHE, PLAYED_PREFIX, SW_MESSAGE } from './names'
import { bucketFileFor, fetchFromBucket, type BucketFile } from './bucket'

declare const self: ServiceWorkerGlobalScope

/**
 * Serve audio: from this device when it is here, from the bucket when it is not.
 *
 * A downloaded song is a complete 200 in the cache, and a player asking for
 * bytes 500-999 gets a correctly-formed 206 slice built here, because the
 * Cache API will not do it. A song that was never downloaded comes from the
 * bucket, once per play, and only the last few played are kept
 * (`playFromBucket`) — a library of a thousand songs is not something a
 * browser tab should quietly copy.
 */
export async function handleAudio(
  request: Request,
  url: URL,
  event: FetchEvent,
): Promise<Response> {
  const cache = await caches.open(AUDIO_CACHE)
  const cacheKey = url.pathname

  /*
   * A download saying it wants fresh bytes gets them.
   *
   * `cache: 'reload'` only skips the browser's HTTP cache — this worker sits
   * in front of that and would hand back the copy the page is trying to
   * replace, so a song whose file changed on the server could never be refreshed
   * and every pass re-stored what it already had. The page asks with a header
   * rather than a query, since what is stored is keyed by path alone.
   */
  const wantsFresh = request.headers.get(REFRESH_HEADER) !== null
  // The page keeps a download under its whole stream address, `?v=` and all,
  // and the player may ask with another query: the path is what names a song.
  const cached = wantsFresh ? undefined : await cache.match(cacheKey, { ignoreSearch: true })

  if (cached) {
    const range = request.headers.get('range')
    if (!range) return cached
    return sliceResponse(cached, range)
  }

  const fromBucket = await bucketFileFor(url, 'audio')
  if (fromBucket) return playFromBucket(fromBucket, request, event)

  // Served by the server, and not on this device: go to the network and store
  // nothing. What this cache holds is the page's decision, never a side
  // effect of playing something (src/ports/offline.web.ts).
  try {
    return await fetch(request)
  } catch {
    return new Response('This song is not available offline.', {
      status: 503,
      statusText: 'Offline',
      headers: { 'Content-Type': 'text/plain' },
    })
  }
}

/** Whole downloads under way, by bucket key. */
const arriving = new Map<string, Arriving>()

/**
 * A cloud song, from the bucket: one download per play, kept for the next.
 *
 * Every range the player asked for was a request to the bucket, and the
 * bucket counts each against a daily allowance (docs/SYNC.md, "Caps"):
 * Safari's first two-byte look and the range after it, every seek past what
 * the player had buffered, and the whole song again on every replay once the
 * page had been reloaded. So the first request for a song starts one download
 * of the whole file, and every range — this one, the next, a seek — is read
 * from that download as it arrives. Once it is all here it is kept, under
 * the file's key, which is the hash of its bytes and so right for as long as
 * it is kept: the last `PLAYED_KEPT` songs, oldest first out. A replay, the
 * next song preloaded ahead of time, and a download the page makes of the
 * song are answered from the copy.
 *
 * A range that starts well past what has arrived — a song resumed half-way
 * through on a slow connection — is asked for as it is: one request more.
 */
async function playFromBucket(
  file: BucketFile,
  request: Request,
  event: FetchEvent,
): Promise<Response> {
  const range = request.headers.get('range')
  const cache = await caches.open(PLAYED_CACHE)
  const name = playedName(file.key)
  const kept = await cache.match(name)
  if (kept) return range ? sliceResponse(kept, range) : kept
  if (request.method === 'HEAD') return fetchFromBucket(file, range)

  let download = arriving.get(file.key)
  if (!download) {
    download = new Arriving(file, cache, name)
    arriving.set(file.key, download)
    // The worker stays up until the song is kept, whatever the player does meanwhile.
    event.waitUntil(download.kept)
  }
  const head = await download.head
  if (head.kind === 'refused') return download.refusal()

  const wanted = parseRange(range, head.size)
  if (wanted === null) return download.whole()
  if (wanted === 'unsatisfiable') return rangeNotSatisfiable(head.size)
  if (wanted.start > download.received + WAIT_AHEAD_BYTES) return fetchFromBucket(file, range)
  return download.slice(wanted.start, wanted.end)
}

/**
 * One song arriving from the bucket, whole, and readable from anywhere in it
 * while it does. Held in memory until it is all here — a song, a few
 * megabytes — then put in the cache and forgotten here.
 */
class Arriving {
  readonly head: Promise<{ kind: 'refused' } | { kind: 'ok'; size: number }>
  readonly kept: Promise<void>
  received = 0
  #chunks: Uint8Array[] = []
  #done = false
  #failed = false
  #response: Response | null = null
  /** The bucket's refusal, read once so each request waiting on it can be answered with it. */
  #refused: { status: number; headers: Headers; text: string } | null = null
  #wake: (() => void)[] = []

  constructor(file: BucketFile, cache: Cache, name: string) {
    const answered = fetchFromBucket(file)
    this.head = answered.then(async response => {
      this.#response = response
      const size = Number(response.headers.get('content-length') ?? Number.NaN)
      if (response.status === 200 && response.body && Number.isFinite(size) && size > 0) {
        return { kind: 'ok' as const, size }
      }
      const text = await response.text().catch(() => '')
      this.#refused = { status: response.status, headers: response.headers, text }
      return { kind: 'refused' as const }
    })
    this.kept = this.#read(cache, name)
      .catch(() => {
        // Stopped half-way, or a storage quota: the song played, and the next
        // play fetches it again.
        this.#failed = true
        this.#notify()
      })
      .finally(() => arriving.delete(file.key))
  }

  async #read(cache: Cache, name: string): Promise<void> {
    const head = await this.head
    const response = this.#response
    if (head.kind !== 'ok' || !response?.body) {
      this.#failed = true
      this.#notify()
      return
    }
    const reader = response.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      this.#chunks.push(value)
      this.received += value.byteLength
      this.#notify()
    }
    if (this.received !== head.size) throw new Error('the song stopped short')
    this.#done = true
    this.#notify()
    const headers = new Headers(response.headers)
    headers.set('Cache-Control', 'private, max-age=31536000, immutable')
    // The chunks stay: a range still streaming from this download reads them
    // until it closes, and the whole of it goes with the last one.
    await cache.put(
      name,
      new Response(new Blob(this.#chunks as BlobPart[]), { status: 200, headers }),
    )
    const names = await cache.keys()
    for (const old of names.slice(0, Math.max(0, names.length - PLAYED_KEPT))) {
      await cache.delete(old)
    }
    // The pages count a kept song as on this browser (src/ports/playedCopies.web.ts):
    // with the bucket refusing for the day, it is one of the few that still play.
    const clients = await self.clients.matchAll({ type: 'window' })
    for (const client of clients) client.postMessage({ type: SW_MESSAGE.played })
  }

  /** The bucket's own answer when it would not give the song: a cap's 502, say. */
  refusal(): Response {
    const refused = this.#refused
    return refused && refused.status !== 200
      ? new Response(refused.text, { status: refused.status, headers: refused.headers })
      : new Response('The song could not be fetched.', { status: 502 })
  }

  /** The whole song as it arrives, for the page keeping a copy. */
  async whole(): Promise<Response> {
    const head = await this.head
    if (head.kind !== 'ok') return this.refusal()
    const headers = new Headers({
      'Content-Type': this.#response?.headers.get('content-type') ?? 'audio/mp4',
      'Content-Length': String(head.size),
      'Accept-Ranges': 'bytes',
    })
    return new Response(this.#stream(0, head.size - 1), { status: 200, headers })
  }

  /** Bytes `start` to `end`, inclusive, as a 206 that streams as they arrive. */
  async slice(start: number, end: number): Promise<Response> {
    const head = await this.head
    if (head.kind !== 'ok') return this.refusal()
    const headers = new Headers({
      'Content-Type': this.#response?.headers.get('content-type') ?? 'audio/mp4',
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${head.size}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    })
    return new Response(this.#stream(start, end), {
      status: 206,
      statusText: 'Partial Content',
      headers,
    })
  }

  #stream(start: number, end: number): ReadableStream<Uint8Array> {
    let at = start
    return new ReadableStream<Uint8Array>({
      pull: async controller => {
        while (at > end || this.received <= at) {
          if (at > end) {
            controller.close()
            return
          }
          if (this.#failed || this.#done) {
            controller.error(new Error('the song stopped arriving'))
            return
          }
          await new Promise<void>(resolve => this.#wake.push(resolve))
        }
        const bytes = this.#bytes(at, Math.min(end, this.received - 1))
        at += bytes.byteLength
        controller.enqueue(bytes)
        if (at > end) controller.close()
      },
    })
  }

  /** The bytes from `from` to `to`, inclusive, out of the chunks that hold them. */
  #bytes(from: number, to: number): Uint8Array {
    const out = new Uint8Array(to - from + 1)
    let offset = 0
    let filled = 0
    for (const chunk of this.#chunks) {
      const chunkEnd = offset + chunk.byteLength
      if (chunkEnd > from && offset <= to) {
        const begin = Math.max(from, offset) - offset
        const stop = Math.min(to + 1, chunkEnd) - offset
        out.set(chunk.subarray(begin, stop), filled)
        filled += stop - begin
      }
      offset = chunkEnd
      if (offset > to) break
    }
    return out
  }

  #notify(): void {
    const waiting = this.#wake
    this.#wake = []
    for (const resolve of waiting) resolve()
  }
}

/** Where a played song is kept: under the worker's own scope, by its bucket key. */
function playedName(key: string): string {
  return new URL(`${PLAYED_PREFIX}${key}`, self.registration.scope).href
}

/**
 * Build a 206 Partial Content response from a complete cached one.
 *
 * Which bytes is packages/shared's `parseRange`, the rule the server and the
 * desktop shell answer `Range:` by: a header that is not one byte range —
 * `bytes=-` among them — is answered with the whole file, as they answer it.
 *
 * Through a blob, not an array buffer: a player asks for a song a range at a
 * time, and reading the whole file into this worker's memory for each range
 * would be a song's worth of copying per seek. A cached response's blob is
 * backed by the cache on disk, and slicing it copies nothing until the bytes
 * are read.
 */
async function sliceResponse(response: Response, rangeHeader: string): Promise<Response> {
  // Not a range at all: the whole file, without reading it here.
  if (relayedRange(rangeHeader) === null) return response
  const blob = await response.blob()
  const size = blob.size
  const wanted = parseRange(rangeHeader, size)
  if (wanted === null) return new Response(blob, response)
  if (wanted === 'unsatisfiable') return rangeNotSatisfiable(size)
  const { start, end } = wanted

  const headers = new Headers()
  headers.set('Content-Type', response.headers.get('content-type') ?? 'audio/mp4')
  headers.set('Content-Length', String(end - start + 1))
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
  headers.set('Accept-Ranges', 'bytes')
  headers.set('Cache-Control', 'private, max-age=31536000, immutable')

  return new Response(blob.slice(start, end + 1), {
    status: 206,
    statusText: 'Partial Content',
    headers,
  })
}

function rangeNotSatisfiable(size: number): Response {
  return new Response(null, {
    status: 416,
    statusText: 'Range Not Satisfiable',
    headers: { 'Content-Range': `bytes */${size}` },
  })
}
