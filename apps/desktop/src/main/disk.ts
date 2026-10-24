import { createReadStream, type Stats } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'

import { answerRange, fileEtag } from '@selfmp3/shared'

import { contentTypeFor } from './paths.js'

/**
 * A file on this computer, answered as the server answers one: `Range:` read
 * by `packages/shared`'s rule, so a seek gets its 206 and a range past the end
 * its 416.
 *
 * Both of the scheme's file answers come here — a downloaded song or cover
 * (`protocol.ts`) and a streamed song already kept in the `played` folder
 * (`stream.ts`) — so a fix to one is a fix to both. They were two copies, and
 * only one of them knew a HEAD wants no body.
 *
 * `net.fetch('file://…')` would not do: it ignores `Range:` and answers 200
 * with the whole body. The caller adds whatever its own answer needs on top,
 * the CORS pair for one, on the headers of what comes back.
 */
export function answerFromDisk(request: Request, path: string, stats: Stats): Response {
  const answer = answerRange({
    rangeHeader: request.headers.get('Range') ?? undefined,
    sizeBytes: stats.size,
    mime: contentTypeFor(path),
    // The file never changes once written — the name carries the song's rev or
    // hash — so size and mtime are an honest strong validator, as the server's are.
    etag: fileEtag(stats.size, stats.mtimeMs),
    lastModified: stats.mtime,
  })
  const headers = new Headers(answer.headers)
  if (request.method === 'HEAD' || answer.status === 416 || answer.length === 0) {
    return new Response(null, { status: answer.status, headers })
  }
  return new Response(
    Readable.toWeb(
      createReadStream(path, { start: answer.start, end: answer.end }),
    ) as ReadableStream,
    { status: answer.status, headers },
  )
}

/** A file's stats, or null when there is no file there — nothing, or a directory. */
export async function fileStats(path: string): Promise<Stats | null> {
  try {
    const stats = await stat(path)
    return stats.isFile() ? stats : null
  } catch {
    return null
  }
}
