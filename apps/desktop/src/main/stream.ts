import { mkdir, open, readdir, rename, rm, stat, utimes, type FileHandle } from 'node:fs/promises'
import { join } from 'node:path'

import {
  BUCKET_CAP_CODE,
  BUCKET_HOLD_MS,
  DOORMAN_ERROR,
  DOORMAN_PATHS,
  PLAYED_KEPT,
  STREAM_RELAYED_HEADERS,
  WAIT_AHEAD_BYTES,
  isCloudFileKey,
  isHashNamedCloudKey,
  parseDoormanRefusal,
  parseRange,
  relayedRange,
} from '@selfmp3/shared'
import type { StreamSession } from '@selfmp3/desktop-bridge'

import { answerFromDisk, fileStats } from './disk.js'
import { contentTypeFor } from './paths.js'

/**
 * A song in the bucket, streamed: `app://selfmp3/_stream/<key>`.
 *
 * The doorman reads a bearer header and nothing else, and the window's
 * `<audio>` element cannot send one. A tab has its service worker attach it
 * (apps/app/sw/sw.ts, `playFromBucket`) and a phone's player sends it with
 * each track; here the main process does, which is the worker's `cloud`
 * branch in Node. The page points the element at this address
 * (apps/app/src/ports/desktop/bucketMedia.desktop.ts).
 *
 * **One read of the bucket per song, not per range.** The bucket counts every
 * request against a daily allowance (docs/SYNC.md, "Caps"), and an `<audio>`
 * element asks in ranges: a first look, the range after it, one per seek, the
 * next song preloaded. So the first request for a song starts one download of
 * the whole file into the `played` folder, and every range — that one, the
 * next, a seek — is read from the file as it arrives, so playback starts
 * without waiting for the end. Once whole it is kept, under a name made of its
 * key, which is the hash of its bytes and so right for as long as it is kept:
 * the last `PLAYED_KEPT` songs, the least recently played going first. A
 * replay, the next song preloaded and the page's own copy of a played song
 * (ports/desktop/recentCopies.desktop.ts asks this address for it) are
 * answered from the disk. A range that starts well past what has arrived — a
 * song resumed half-way on a slow connection — is asked of the doorman by
 * itself, as the worker does: one request more rather than a long wait.
 *
 * The session is the page's, handed over with `bucket.use` and kept in this
 * process's memory alone: the page keeps it beside the replica, where the main
 * process cannot read it. It is never logged and never sent anywhere but the
 * doorman it names.
 */

/** What answers the doorman's address: Electron's `net.fetch`, or a test's doorman. */
type Fetch = (
  url: string,
  init: { method: string; headers: Headers; signal?: AbortSignal },
) => Promise<Response>

interface StreamProxyOptions {
  readonly fetch: Fetch
  /** The bucket refused for the day: told to the page, so its own reads hold off and it says why. */
  readonly onCapped: (message: string) => void
  /** Where the played songs are kept: the shell's `played` folder. */
  readonly dir: string
  readonly now?: () => number
}

export interface StreamProxy {
  use(session: StreamSession): void
  /**
   * The answer to a request for `key`. `allowOrigin` is the origin the CORS
   * pair names — the caller's to decide, as for a file on disk (`protocol.ts`).
   */
  serve(request: Request, key: string, allowOrigin: string): Promise<Response>
}

/** The doorman would not give the file: what it said, to say again to each request that waits on it. */
interface Refusal {
  readonly status: number
  readonly body: string
  readonly contentRange: string | null
}

/** How much of a song one read from the disk hands the player. */
const READ_CHUNK = 256 * 1024

export function createStreamProxy({
  fetch,
  onCapped,
  dir,
  now = () => Date.now(),
}: StreamProxyOptions): StreamProxy {
  let session: StreamSession = null

  /*
   * The bucket refusing for the day (docs/SYNC.md, "Caps"), as the service
   * worker keeps it: for as long as the page's own hold lasts nothing is
   * asked, and every range the player wants is answered with the doorman's
   * refusal from here; then one real request finds out whether it is over.
   */
  let capped: { readonly until: number; readonly body: string } | null = null

  /** Whole downloads under way, by file name in the folder. */
  const arriving = new Map<string, Arriving>()

  /** When each song still arriving was last asked for: what it is kept as, once whole. */
  const askedAt = new Map<string, number>()

  /** The kept songs by file name, and when each was last played; read from the folder once. */
  let kept: Promise<Map<string, number>> | null = null

  function keptSongs(): Promise<Map<string, number>> {
    kept ??= (async () => {
      const found = new Map<string, number>()
      try {
        for (const name of await readdir(dir)) {
          const path = join(dir, name)
          // A download a quit interrupted: never a song, so never served.
          if (name.endsWith('.part')) await rm(path, { force: true })
          else found.set(name, (await stat(path)).mtimeMs)
        }
      } catch {
        // No folder yet: nothing kept.
      }
      return found
    })()
    return kept
  }

  /** Played again: the newest, and so the last to go. Written to the file too, for the next launch. */
  async function touch(name: string): Promise<void> {
    const at = now()
    ;(await keptSongs()).set(name, at)
    await utimes(join(dir, name), at / 1000, at / 1000).catch(() => {})
  }

  /**
   * A whole song, kept, and the oldest past `PLAYED_KEPT` let go. It is kept as
   * played when it was last asked for, not when its last byte landed: a song
   * another play overtook while it was arriving is the older of the two, and
   * one asked for again in that time is the newer.
   */
  async function keep(name: string): Promise<void> {
    const songs = await keptSongs()
    songs.set(name, askedAt.get(name) ?? now())
    askedAt.delete(name)
    const oldestFirst = [...songs].sort(([, a], [, b]) => a - b)
    for (const [old] of oldestFirst.slice(0, Math.max(0, songs.size - PLAYED_KEPT))) {
      songs.delete(old)
      // A player still reading it keeps its open file until it is done.
      await rm(join(dir, old), { force: true })
    }
  }

  /**
   * The doorman's answer for `key`, or what it said instead. A cap's refusal
   * is held, and no answer at all is "offline".
   */
  async function ask(
    key: string,
    current: NonNullable<StreamSession>,
    init: { method: 'GET' | 'HEAD'; range?: string | null; signal?: AbortSignal },
  ): Promise<Response | Refusal> {
    if (capped !== null) {
      if (now() < capped.until) return { status: 502, body: capped.body, contentRange: null }
      capped = null
    }
    const headers = new Headers({ Authorization: `Bearer ${current.token}` })
    if (init.range) headers.set('Range', init.range)

    let upstream: Response
    try {
      upstream = await fetch(`${current.doormanUrl}${DOORMAN_PATHS.file(key)}`, {
        method: init.method,
        headers,
        ...(init.signal ? { signal: init.signal } : {}),
      })
    } catch {
      return {
        status: 503,
        body: 'This song is not on this device, and your storage cannot be reached.',
        contentRange: null,
      }
    }
    if (upstream.ok) return upstream

    // A refusal is small JSON, read whole: a cap is the one worth holding,
    // and a 401 — the session over — goes back as the doorman said it, for
    // the player to explain (ports/streamFailure.model.ts).
    const body = await upstream.text().catch(() => '')
    const refusal = parseDoormanRefusal(body)
    if (upstream.status === 502 && refusal?.code === BUCKET_CAP_CODE) {
      capped = { until: now() + BUCKET_HOLD_MS, body }
      onCapped(refusal.error)
    }
    return { status: upstream.status, body, contentRange: upstream.headers.get('content-range') }
  }

  /** The doorman's answer to this very request, passed on: a HEAD, a key no hash names, a far seek. */
  async function relay(
    request: Request,
    key: string,
    current: NonNullable<StreamSession>,
  ): Promise<Response> {
    const method = request.method === 'HEAD' ? 'HEAD' : 'GET'
    const upstream = await ask(key, current, {
      method,
      range: relayedRange(request.headers.get('Range')),
    })
    if (!(upstream instanceof Response)) return refused(upstream)
    const headers = new Headers()
    for (const name of [...STREAM_RELAYED_HEADERS, 'etag', 'last-modified']) {
      const value = upstream.headers.get(name)
      if (value !== null) headers.set(name, value)
    }
    headers.set(
      'Cache-Control',
      upstream.status === 206 ? 'no-store' : 'private, max-age=31536000, immutable',
    )
    return new Response(method === 'HEAD' ? null : upstream.body, {
      status: upstream.status,
      headers,
    })
  }

  /** A song named by its hash: from the folder, or from the one download of it. */
  async function play(
    request: Request,
    key: string,
    current: NonNullable<StreamSession>,
  ): Promise<Response> {
    const name = key.split('/').join('-')
    const range = request.headers.get('Range')
    const path = join(dir, name)
    const songs = await keptSongs()
    const stats = songs.has(name) ? await fileStats(path) : null
    if (stats !== null) {
      void touch(name)
      return answerFromDisk(request, path, stats)
    }
    // Gone from under the note: the page cleared the folder, at sign-out or "Remove all".
    songs.delete(name)
    if (request.method === 'HEAD') return relay(request, key, current)

    askedAt.set(name, now())
    let download = arriving.get(name)
    if (!download) {
      const started = new Arriving(
        signal => ask(key, current, { method: 'GET', signal }),
        dir,
        name,
        () => keep(name),
      )
      download = started
      arriving.set(name, started)
      void started.settled.finally(() => {
        if (arriving.get(name) !== started) return
        arriving.delete(name)
        // Kept by now, or stopped short: either way nothing more to keep it as.
        askedAt.delete(name)
      })
    }
    const head = await download.head
    if (head.kind === 'refused') return refused(head.refusal)

    const wanted = parseRange(range, head.size)
    if (wanted === 'unsatisfiable') {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${head.size}`, 'Cache-Control': 'no-store' },
      })
    }
    if (wanted === null) return download.answer(0, head.size - 1, head.size, false)
    if (wanted.start > download.received + WAIT_AHEAD_BYTES) return relay(request, key, current)
    return download.answer(wanted.start, wanted.end, head.size, true)
  }

  return {
    use(next) {
      if (next?.token !== session?.token || next?.doormanUrl !== session?.doormanUrl) {
        // Another session may be another bucket, with a day of its own; and
        // a download asked for with the last one is not this one's to finish.
        capped = null
        for (const download of arriving.values()) download.abort()
        arriving.clear()
      }
      session = next
    },

    async serve(request, key, allowOrigin) {
      const answer = await (async () => {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } })
        }
        // Only what the doorman would let a device read: never a path the page made up.
        if (!isCloudFileKey(key)) return new Response('not found', { status: 404 })
        const current = session
        if (current === null) {
          return refused({
            status: 401,
            body: JSON.stringify({ error: 'Signed out', code: DOORMAN_ERROR.unauthorized }),
            contentRange: null,
          })
        }
        // A file named by its hash is that file for good, so worth keeping; anything else is asked each time.
        return isHashNamedCloudKey(key) ? play(request, key, current) : relay(request, key, current)
      })()
      // The engine asks with credentials so the analyser may read the samples,
      // and that mode wants an origin named rather than `*` (protocol.ts).
      answer.headers.set('Access-Control-Allow-Origin', allowOrigin)
      answer.headers.set('Access-Control-Allow-Credentials', 'true')
      return answer
    },
  }
}

type Head = { kind: 'refused'; refusal: Refusal } | { kind: 'ok'; size: number }

/**
 * One song arriving from the doorman, whole, into `<name>.part`, and readable
 * from anywhere in it while it does. Renamed to its name once all there, and
 * only then kept: a file under its real name is a whole song.
 */
class Arriving {
  readonly head: Promise<Head>
  /** Done, failed or refused: the download is over either way. */
  readonly settled: Promise<void>
  /** Bytes on the disk so far, readable by the players waiting on them. */
  received = 0
  readonly #type: string
  #done = false
  #failed = false
  #wake: (() => void)[] = []
  readonly #controller = new AbortController()
  /** One handle the players read through, positioned per read, closed once nobody needs it. */
  #reader: FileHandle | null = null
  #readers = 0

  constructor(
    get: (signal: AbortSignal) => Promise<Response | Refusal>,
    dir: string,
    name: string,
    kept: () => Promise<void>,
  ) {
    this.#type = contentTypeFor(name)
    const part = join(dir, `${name}.part`)
    let opened: (head: Head) => void = () => {}
    this.head = new Promise<Head>(resolve => {
      opened = resolve
    })
    this.settled = (async () => {
      let writer: FileHandle | null = null
      try {
        const response = await get(this.#controller.signal)
        if (!(response instanceof Response)) {
          opened({ kind: 'refused', refusal: response })
          return
        }
        const size = Number(response.headers.get('content-length') ?? Number.NaN)
        if (response.status !== 200 || !response.body || !Number.isFinite(size) || size <= 0) {
          await response.body?.cancel().catch(() => {})
          opened({
            kind: 'refused',
            refusal: { status: 502, body: 'The song could not be fetched.', contentRange: null },
          })
          return
        }
        await mkdir(dir, { recursive: true })
        writer = await open(part, 'w')
        this.#reader = await open(part, 'r')
        opened({ kind: 'ok', size })

        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          for (let written = 0; written < chunk.byteLength;) {
            written += (await writer.write(chunk, written)).bytesWritten
          }
          this.received += chunk.byteLength
          this.#notify()
        }
        await writer.close()
        writer = null
        if (this.received !== size) throw new Error('the song stopped short')
        await rename(part, join(dir, name))
        this.#done = true
        this.#notify()
        await kept()
      } catch {
        // Stopped half-way, aborted, or the disk refused: the song played as
        // far as it got, and the next play fetches it again.
        opened({
          kind: 'refused',
          refusal: {
            status: 503,
            body: 'This song is not on this device, and your storage cannot be reached.',
            contentRange: null,
          },
        })
        this.#failed = true
        this.#notify()
        await writer?.close().catch(() => {})
        await rm(part, { force: true }).catch(() => {})
      } finally {
        this.#release()
      }
    })()
  }

  abort(): void {
    this.#controller.abort()
  }

  /** Bytes `start` to `end`, inclusive: a 206 when a range was asked for, else the whole as a 200. */
  answer(start: number, end: number, size: number, ranged: boolean): Response {
    const length = end - start + 1
    return new Response(this.#stream(start, end), {
      status: ranged ? 206 : 200,
      headers: {
        'Content-Type': this.#type,
        'Content-Length': String(length),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
        ...(ranged ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
      },
    })
  }

  #stream(start: number, end: number): ReadableStream<Uint8Array> {
    let at = start
    let reading = true
    this.#readers += 1
    const stop = (): void => {
      if (!reading) return
      reading = false
      this.#readers -= 1
      this.#release()
    }
    return new ReadableStream<Uint8Array>({
      pull: async controller => {
        try {
          while (this.received <= at) {
            if (this.#failed || this.#done || this.#reader === null) {
              throw new Error('the song stopped arriving')
            }
            await new Promise<void>(resolve => this.#wake.push(resolve))
          }
          const length = Math.min(end, this.received - 1, at + READ_CHUNK - 1) - at + 1
          const buffer = Buffer.alloc(length)
          const { bytesRead } = await this.#reader!.read(buffer, 0, length, at)
          if (bytesRead === 0) throw new Error('the song stopped arriving')
          at += bytesRead
          controller.enqueue(new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead))
          if (at > end) {
            stop()
            controller.close()
          }
        } catch (error) {
          stop()
          controller.error(error)
        }
      },
      cancel: stop,
    })
  }

  #notify(): void {
    const waiting = this.#wake
    this.#wake = []
    for (const wake of waiting) wake()
  }

  /** The read handle goes once the download is over and no player is reading through it. */
  #release(): void {
    if (this.#readers > 0 || !(this.#done || this.#failed)) return
    const reader = this.#reader
    this.#reader = null
    void reader?.close().catch(() => {})
  }
}

function refused({ status, body, contentRange }: Refusal): Response {
  const answer = new Response(body === '' ? null : body, {
    status,
    headers: {
      'Content-Type': body.startsWith('{') ? 'application/json' : 'text/plain',
      'Cache-Control': 'no-store',
    },
  })
  if (contentRange) answer.headers.set('Content-Range', contentRange)
  return answer
}
