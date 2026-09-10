import fs from 'node:fs'
import type { Request, Response } from 'express'
import { pipeline } from 'node:stream/promises'

/**
 * HTTP range request handling for audio.
 *
 * This is what makes seeking work. Without a correct 206 response the browser
 * has to download a whole track before it can jump to the middle of it, and
 * iOS Safari refuses to play at all. Getting the edge cases right here is the
 * difference between an app that feels instant and one that feels broken.
 */

export interface RangeSource {
  readonly sizeBytes: number
  readonly mime: string
  readonly etag: string
  readonly lastModified: Date
  /** Inclusive byte offsets, as HTTP defines them. */
  open(start: number, end: number): NodeJS.ReadableStream
}

/** Parse a single-range `Range: bytes=...` header. Multi-range is not supported. */
export function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | 'unsatisfiable' | null {
  if (!header) return null

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null

  const [, rawStart = '', rawEnd = ''] = match
  if (rawStart === '' && rawEnd === '') return null

  let start: number
  let end: number

  if (rawStart === '') {
    // `bytes=-500` means the final 500 bytes.
    const suffixLength = Number(rawEnd)
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return 'unsatisfiable'
    start = Math.max(0, size - suffixLength)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd === '' ? size - 1 : Number(rawEnd)
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null
    // A range that starts past the end of the file is unsatisfiable...
    if (start >= size) return 'unsatisfiable'
    // ...but one that merely *ends* past it is clamped, per the spec.
    end = Math.min(end, size - 1)
  }

  if (start > end) return 'unsatisfiable'
  return { start, end }
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

  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Content-Type', mime)
  res.setHeader('ETag', etag)
  res.setHeader('Last-Modified', lastModified.toUTCString())
  // Audio files are immutable once written; a long cache is safe and is what
  // makes offline playback from the service worker cache cheap.
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable')

  if (isFresh(req, etag, lastModified)) {
    res.status(304).end()
    return
  }

  const range = parseRange(req.headers.range, sizeBytes)

  if (range === 'unsatisfiable') {
    res.setHeader('Content-Range', `bytes */${sizeBytes}`)
    res.status(416).end()
    return
  }

  const start = range ? range.start : 0
  const end = range ? range.end : sizeBytes - 1
  const length = end - start + 1

  if (range) {
    res.status(206)
    res.setHeader('Content-Range', `bytes ${start}-${end}/${sizeBytes}`)
  } else {
    res.status(200)
  }
  res.setHeader('Content-Length', String(length))

  if (req.method === 'HEAD') {
    res.end()
    return
  }

  const stream = source.open(start, end)
  try {
    await pipeline(stream, res)
  } catch (error) {
    // A client seeking or skipping aborts the request mid-stream. That is
    // normal behaviour, not an error worth surfacing.
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code === 'ERR_STREAM_PREMATURE_CLOSE' || code === 'EPIPE' || code === 'ECONNRESET') return
    throw error
  }
}

/** Build a `RangeSource` from a file on local disk. */
export function fileRangeSource(absolutePath: string, mime: string): RangeSource {
  const stat = fs.statSync(absolutePath)
  return {
    sizeBytes: stat.size,
    mime,
    // Size plus mtime is enough to detect any realistic change to a music file
    // and costs nothing, unlike hashing megabytes on every request.
    etag: `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`,
    lastModified: stat.mtime,
    open: (start, end) => fs.createReadStream(absolutePath, { start, end }),
  }
}
