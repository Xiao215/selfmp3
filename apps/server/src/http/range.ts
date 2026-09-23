import type { Request, Response } from 'express'
import { pipeline } from 'node:stream/promises'

import { answerRange } from '@selfmp3/shared'

/**
 * HTTP range request handling for audio: Express's half of it.
 *
 * The rule itself — what `bytes=…` means, and which bytes it asks for — lives in
 * `@selfmp3/shared` (`packages/shared/src/range.ts`), because the desktop shell
 * has to answer the same header for the files it serves over `app://`, and two
 * implementations of a byte range is one too many. This file keeps what only a
 * server has: the streaming, the 304, and the aborted-request handling.
 *
 * Without a correct 206 response the browser has to download a whole track
 * before it can jump to the middle of it, and iOS Safari refuses to play at all.
 */

export interface RangeSource {
  readonly sizeBytes: number
  readonly mime: string
  readonly etag: string
  readonly lastModified: Date
  /**
   * Inclusive byte offsets, as HTTP defines them. Both real sources have to
   * ask something before they have bytes — a bucket, a file's stat — so this
   * is a promise of the stream, not the stream: `pipeline` then owns the real
   * upstream, destroys it when the client goes, and an error before the first
   * byte is a rejection here rather than an `'error'` event with nobody on it.
   * `signal` is aborted when the client goes before the promise settles.
   */
  open(start: number, end: number, signal: AbortSignal): Promise<NodeJS.ReadableStream>
}

/** True when the client's cached copy is still good. */
function isFresh(req: Request, etag: string, lastModified: Date): boolean {
  const ifNoneMatch = req.headers['if-none-match']
  if (ifNoneMatch) {
    return ifNoneMatch
      .split(',')
      .map(value => value.trim().replace(/^W\//, ''))
      .includes(etag)
  }
  const ifModifiedSince = req.headers['if-modified-since']
  if (ifModifiedSince) {
    const since = Date.parse(ifModifiedSince)
    // Compare at second precision; HTTP dates have no sub-second component.
    if (Number.isFinite(since)) {
      return Math.floor(lastModified.getTime() / 1000) <= Math.floor(since / 1000)
    }
  }
  return false
}

export async function sendRange(req: Request, res: Response, source: RangeSource): Promise<void> {
  const { sizeBytes, mime, etag, lastModified } = source

  const answer = answerRange({
    rangeHeader: req.headers.range,
    sizeBytes,
    mime,
    etag,
    lastModified,
  })

  // The validators and the cache rule are the same whatever the answer, so a
  // 304 carries them too.
  for (const [name, value] of Object.entries(answer.headers)) {
    if (name !== 'Content-Length' && name !== 'Content-Range') res.setHeader(name, value)
  }

  if (isFresh(req, etag, lastModified)) {
    res.status(304).end()
    return
  }

  if (answer.status === 416) {
    res.setHeader('Content-Range', answer.headers['Content-Range'] as string)
    res.status(416).end()
    return
  }

  res.status(answer.status)
  if (answer.status === 206) {
    res.setHeader('Content-Range', answer.headers['Content-Range'] as string)
  }
  res.setHeader('Content-Length', String(answer.length))

  if (req.method === 'HEAD') {
    res.end()
    return
  }

  /*
   * An empty file has nothing to stream, and asking for bytes 0 to -1 throws.
   * Letting that through was worse than the empty file: the headers here are
   * already set, so the error handler's JSON went out as audio, cached for a
   * year and marked immutable — one broken file poisoning the song for good.
   */
  if (answer.length <= 0) {
    res.end()
    return
  }

  // A client seeking or skipping closes the response. The fetch behind it is
  // called off with it rather than left to finish for nobody, and the stream
  // it had already started is destroyed by `pipeline`.
  const gone = new AbortController()
  res.once('close', () => gone.abort())
  try {
    const stream = await source.open(answer.start, answer.end, gone.signal)
    await pipeline(stream, res)
  } catch (error) {
    // That is normal behaviour, not an error worth surfacing.
    if (gone.signal.aborted) return
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code === 'ERR_STREAM_PREMATURE_CLOSE' || code === 'EPIPE' || code === 'ECONNRESET') return
    throw error
  }
}
