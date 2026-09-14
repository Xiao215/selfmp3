/**
 * Answering `Range:` for audio, as a rule with no server in it.
 *
 * This was `apps/server/src/http/range.ts`, which has more tests than anything
 * else in the repository and has been getting seeking right for a year. It is
 * here because the desktop shell now has to answer the same header: Electron's
 * `protocol.handle` hands over the request's `Range:`, but `net.fetch` of a
 * `file://` URL ignores it and answers 200 with the whole body, so the 206 has
 * to be built by hand — and building a second one would be building a second
 * set of bugs.
 *
 * The server keeps its Express glue (`sendRange`) and imports the rule; the
 * shell imports the same rule and writes Electron's `Response`. One parser,
 * tested once, in `range.test.ts` beside this file.
 *
 * Without a correct 206 a browser has to fetch a whole track before it can jump
 * to the middle of it, and iOS Safari refuses to play at all.
 */

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

/**
 * The whole answer to a request for a file, as numbers and headers.
 *
 * Everything the two callers agreed on anyway: the status, the byte range to
 * read, and the headers that go with it. `sendRange` adds the streaming and the
 * 304; the shell adds the CORS pair its custom scheme needs. What neither has
 * to get right twice is which bytes and which `Content-Range`.
 */
export interface RangeAnswer {
  readonly status: 200 | 206 | 416
  /** Inclusive byte offsets, as HTTP defines them. Absent for a 416. */
  readonly start: number
  readonly end: number
  /** How many bytes the body carries. Zero for a 416 and for an empty file. */
  readonly length: number
  readonly headers: Readonly<Record<string, string>>
}

export function answerRange({
  rangeHeader,
  sizeBytes,
  mime,
  etag,
  lastModified,
}: {
  rangeHeader: string | undefined
  sizeBytes: number
  mime: string
  etag: string
  lastModified: Date
}): RangeAnswer {
  const common: Record<string, string> = {
    'Accept-Ranges': 'bytes',
    'Content-Type': mime,
    ETag: etag,
    'Last-Modified': lastModified.toUTCString(),
    // Audio files are immutable once written; a long cache is safe and is what
    // makes offline playback cheap in both places that serve them.
    'Cache-Control': 'private, max-age=31536000, immutable',
  }

  const range = parseRange(rangeHeader, sizeBytes)

  if (range === 'unsatisfiable') {
    return {
      status: 416,
      start: 0,
      end: -1,
      length: 0,
      headers: { ...common, 'Content-Range': `bytes */${sizeBytes}` },
    }
  }

  const start = range ? range.start : 0
  const end = range ? range.end : sizeBytes - 1
  // An empty file has nothing to stream, and asking for bytes 0 to -1 throws.
  const length = Math.max(0, end - start + 1)

  return range
    ? {
        status: 206,
        start,
        end,
        length,
        headers: {
          ...common,
          'Content-Range': `bytes ${start}-${end}/${sizeBytes}`,
          'Content-Length': String(length),
        },
      }
    : {
        status: 200,
        start,
        end,
        length,
        headers: { ...common, 'Content-Length': String(length) },
      }
}
