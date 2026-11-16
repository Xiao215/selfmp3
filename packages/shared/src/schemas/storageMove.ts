import { z } from 'zod'
import { CloudConnectSchema } from './cloud.js'
import { DoormanBackblazeConnectSchema, DoormanStorageSchema } from './doorman.js'

/**
 * Moving a library from the account's storage to another place
 * (docs/features/storage-providers.md, "Moving").
 *
 * The account has one storage throughout. The new place is connected beside
 * it, as where the move is going (`PUT /v1/storage/move` for a bucket,
 * `POST /v1/storage/drive { move: true }` for Google Drive); the device copies
 * the files across a few at a time (`/v1/storage/move/copy`), and only when
 * nothing is left to copy does the new place become the storage
 * (`/v1/storage/move/finish`). Until then every device goes on reading and
 * writing the old one, and stopping (`DELETE`) changes nothing.
 */
export const DoormanMoveSchema = z.object({
  /** Where the move under way is going, or null when there is none. */
  to: DoormanStorageSchema.nullable(),
})
export type DoormanMove = z.infer<typeof DoormanMoveSchema>

/** A bucket to move to: by its address, or a Backblaze bucket by its key alone. */
export const DoormanMoveStartSchema = z.union([
  z.object({ bucket: CloudConnectSchema }),
  z.object({ backblaze: DoormanBackblazeConnectSchema }),
])
export type DoormanMoveStart = z.infer<typeof DoormanMoveStartSchema>

/**
 * How many files one `/v1/storage/move/copy` may name, copied and removed
 * together. A copy is up to four requests of the doorman's own, and the free
 * plan allows a Worker fifty to an answer.
 */
export const MOVE_COPY_MOST = 8

/**
 * Files to copy to the new place, and files to remove from it: snapshots and
 * logs the old place has since let go of, so those two folders end as copies.
 */
export const DoormanMoveCopySchema = z
  .object({
    keys: z.array(z.string().max(300)).max(MOVE_COPY_MOST),
    remove: z.array(z.string().max(300)).max(MOVE_COPY_MOST),
  })
  .refine(body => body.keys.length + body.remove.length <= MOVE_COPY_MOST, 'too many files at once')
export type DoormanMoveCopy = z.infer<typeof DoormanMoveCopySchema>
