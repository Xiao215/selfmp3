import { CloudServerSchema, IdSchema } from '@selfmp3/shared'
import { z } from 'zod'

/**
 * A cloud library's own routes, which only the cloud build answers (routes.ts):
 * importing by asking the server, through the bucket.
 */

export const CloudImportRequestSchema = z.object({
  /** A link, or text with one in it, as a share sheet sends it. */
  url: z.string().trim().min(1).max(20_000),
  tagIds: z.array(IdSchema).max(50).default([]),
  /** A manual playlist to put what it imports in. */
  playlistId: IdSchema.nullable().default(null),
})
export type CloudImportRequest = z.infer<typeof CloudImportRequestSchema>

export const ImportRequestViewSchema = z.object({
  uid: z.string(),
  url: z.string(),
  state: z.enum(['waiting', 'working', 'done', 'failed', 'cancelled']),
  title: z.string().nullable(),
  songIds: z.array(IdSchema),
  error: z.string().nullable(),
  requestedAt: z.string(),
  requestedBy: z.string(),
})
export type ImportRequestView = z.infer<typeof ImportRequestViewSchema>

export const ImportRequestListSchema = z.object({ imports: z.array(ImportRequestViewSchema) })
export type ImportRequestList = z.infer<typeof ImportRequestListSchema>

/**
 * Where the server behind this library listens, from its last snapshot — for
 * importing through it directly when this device can reach it — or null from
 * a server that never said.
 */
export const CloudServerViewSchema = z.object({ server: CloudServerSchema.nullable() })
export type CloudServerView = z.infer<typeof CloudServerViewSchema>
