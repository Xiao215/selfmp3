import { Router } from 'express'
import { z } from 'zod'
import {
  IMPORT_META_HEADER,
  IMPORT_SHA256_HEADER,
  ImportDeviceFileMetaSchema,
  ImportDeviceJobSchema,
  ImportDeviceReleaseSchema,
  ImportDeviceRenewSchema,
  type ImportDeviceFileMeta,
  type ImportDeviceRenewResult,
  type Ok,
} from '@selfmp3/shared'
import type { Container } from '../container.js'
import { route } from '../http/route.js'
import { HttpError } from '../http/errors.js'

/**
 * The jobs a device downloads itself (docs/features/client-download.md).
 *
 * An import that asked for it (`fetchOnDevice`) comes back with a lease on
 * its YouTube songs. The device renews the lease while it works, says when it
 * starts a song, and either sends the file or lets the job go to the server.
 * A lease left unrenewed runs out, and the server takes what it held.
 */

/**
 * Larger than any song: an hour's mix in m4a is about sixty megabytes. A
 * file past this is refused before it is all read.
 */
const MAX_FILE_BYTES = 300 * 1024 * 1024

const FileParams = z.object({ id: z.string().uuid() })
const FileQuery = z.object({ lease: z.string().min(1).max(100) })

/** The file's description, out of its header: base64url JSON, or nothing at all. */
function metaOf(header: string | string[] | undefined): ImportDeviceFileMeta {
  if (typeof header !== 'string' || header === '') return ImportDeviceFileMetaSchema.parse({})
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'))
  } catch {
    throw HttpError.badRequest(`${IMPORT_META_HEADER} is not base64url JSON`)
  }
  const meta = ImportDeviceFileMetaSchema.safeParse(parsed)
  if (!meta.success) throw HttpError.badRequest(`${IMPORT_META_HEADER} is not a song’s description`)
  return meta.data
}

export function importDeviceRoutes(container: Container): Router {
  const router = Router()

  /** Keep the lease, with each started download's progress; the jobs it still holds. */
  router.post(
    '/import/device/renew',
    route({ body: ImportDeviceRenewSchema }, ({ body }): ImportDeviceRenewResult => ({
      held: container.importQueue.deviceRenew(body.lease, body.progress, body.holding),
    })),
  )

  router.post(
    '/import/device/start',
    route({ body: ImportDeviceJobSchema }, ({ body }): Ok => {
      if (!container.importQueue.deviceStart(body.lease, body.id)) {
        throw HttpError.conflict('that job is not waiting for this device')
      }
      return { ok: true }
    }),
  )

  router.post(
    '/import/device/release',
    route({ body: ImportDeviceReleaseSchema }, ({ body }): Ok => {
      if (!container.importQueue.deviceRelease(body.lease, body.id, body.reason)) {
        throw HttpError.conflict('that job is not this device’s to let go')
      }
      return { ok: true }
    }),
  )

  /**
   * The file, as the body itself: `audio/mp4`, its SHA-256 in
   * `IMPORT_SHA256_HEADER` and what the player said in `IMPORT_META_HEADER`.
   * 202 once it is checked and the job has it; the import goes on from there
   * as any other, and the queue says how it went.
   */
  router.put(
    '/import/device/jobs/:id/file',
    route({ params: FileParams, query: FileQuery }, async ({ params, query, req, res }) => {
      const type = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase()
      if (type !== 'audio/mp4') {
        req.resume()
        throw new HttpError(415, 'only an m4a (audio/mp4) is taken', 'unsupported_media_type')
      }
      const sha256 = req.headers[IMPORT_SHA256_HEADER]
      if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(sha256)) {
        req.resume()
        throw HttpError.badRequest(`${IMPORT_SHA256_HEADER} must be the file’s SHA-256, in hex`)
      }
      const declared = Number(req.headers['content-length'] ?? Number.NaN)
      if (Number.isFinite(declared) && declared > MAX_FILE_BYTES) {
        req.resume()
        throw new HttpError(413, 'that file is larger than any song', 'too_large')
      }
      const meta = metaOf(req.headers[IMPORT_META_HEADER])

      const outcome = await container.importQueue.receiveDeviceFile({
        jobId: params.id,
        lease: query.lease,
        body: req,
        sha256,
        maxBytes: MAX_FILE_BYTES,
        meta,
      })
      if (!outcome.ok) {
        throw new HttpError(outcome.status, outcome.message, 'device_file_refused')
      }
      res.status(202).json({ ok: true } satisfies Ok)
      return undefined
    }),
  )

  return router
}
