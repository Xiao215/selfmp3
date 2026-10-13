/**
 * Answering `Range:` for audio, as a rule with no server in it.
 *
 * Shared because the desktop shell has to answer the same header as the
 * server: Electron's `protocol.handle` hands over the request's `Range:`, but
 * `net.fetch` of a `file://` URL ignores it and answers 200 with the whole
 * body, so the 206 has to be built by hand — and building a second one would
 * be building a second set of bugs.
 *
 * The server keeps its Express glue (`sendRange`) and imports the rule; the
 * shell imports the same rule and writes Electron's `Response`. One parser,
 * tested once, in `range.test.ts` beside this file.
 *
 * Without a correct 206 a browser has to fetch a whole track before it can jump
 * to the middle of it, and iOS Safari refuses to play at all.
 */

const BYTE_RANGE = /^bytes=(\d*)-(\d*)$/

/** Parse a single-range `Range: bytes=...` header. Multi-range is not supported. */
export function parseRange(
  header: string | null | undefined,
  size: number,
): { start: number; end: number } | 'unsatisfiable' | null {
  if (!header) return null

  const match = BYTE_RANGE.exec(header.trim())
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
 * A `Range:` header worth passing on to whoever holds the bytes — a bucket, a
 * server's stream — or null for one that is not a range `parseRange` reads,
 * which is then left off and the whole file asked for, as HTTP lets a server
 * do. One range only: a player never asks for more, and the doorman's two
 * relays used to disagree, one passing several on and the other none.
 */
export function relayedRange(header: string | null | undefined): string | null {
  const range = header?.trim()
  const match = range ? BYTE_RANGE.exec(range) : null
  return match && (match[1] !== '' || match[2] !== '') ? (range ?? null) : null
}

/**
 * What a stream's answer says about itself that a player needs to hear,
 * passed back from a relayed range: a link's preview through the server, and
 * a room's link through the doorman.
 */
export const STREAM_RELAYED_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
] as const

/**
 * The whole answer to a request for a file, as numbers and headers.
 *
 * Everything the two callers agreed on anyway: the status, the byte range to
 * read, and the headers that go with it. `sendRange` adds the streaming and the
 * 304; the shell adds the CORS pair its custom scheme needs. What neither has
 * to get right twice is which bytes and which `Content-Range`.
 */
interface RangeAnswer {
  readonly status: 200 | 206 | 416
  /** Inclusive byte offsets, as HTTP defines them. Meaningless for a 416 (0 and -1). */
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

/**
 * A file's ETag from its size and modification time: a new file under the
 * same name is a new tag. The one formula for every file a server or the
 * desktop shell sends — the audio, a stored image, the sync manifest's
 * entries — so a tag one of them hands out is the tag the other would.
 */
export function fileEtag(sizeBytes: number, mtimeMs: number): string {
  return `"${sizeBytes.toString(16)}-${Math.floor(mtimeMs).toString(16)}"`
}
