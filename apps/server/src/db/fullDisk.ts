import fs from 'node:fs'
import path from 'node:path'

/**
 * Less room than this on the data folder's disk is a full disk. Not zero: a
 * filled APFS volume still reports a megabyte or so free that no file can
 * have, and SQLite could not open in it.
 */
const FULL_BELOW_BYTES = 16 * 1024 * 1024

/**
 * Why the databases in `dir` could not be opened, when the reason is a full
 * disk: SQLite says only "disk I/O error" for a log it has no room to make,
 * and a server that will not start should name the disk and what to do.
 * Null when there is room, or the disk cannot be asked.
 */
export function fullDiskProblem(
  dir: string,
  freeBytes: (dir: string) => number = bytesFreeAt,
): string | null {
  let free: number
  try {
    free = freeBytes(dir)
  } catch {
    return null
  }
  if (free >= FULL_BELOW_BYTES) return null
  return `the disk holding ${dir} is full (${free} bytes free): free some space there and start the server again`
}

/** The room kept aside in the data folder to start in on a full disk (`keepRoomToStart`). */
const ROOM_TO_START_BYTES = 16 * 1024 * 1024
/** The file that holds it: no database's, so a backup leaves it out (cli/backup.ts). */
export const ROOM_TO_START_FILE = 'room-to-start'

/**
 * Keep room on the data folder's disk to start in, and spend it when the
 * disk is full.
 *
 * A database a server stopped hard left with its log is opened by first
 * writing its shared-memory file, and on a full disk that write fails: every
 * read says "disk I/O error", so a server stopped while its disk was full
 * did not start again until someone freed space by hand (bug bash R3-M9).
 * So a start with room sets `ROOM_TO_START_BYTES` aside in a file, and a
 * start on a full disk deletes it and opens the databases in the room that
 * leaves. It is set aside again by the first start with room for it and
 * for the server.
 *
 * Whether the room was spent by this start, for the log to say so.
 */
export function keepRoomToStart(
  dir: string,
  freeBytes: (dir: string) => number = bytesFreeAt,
): boolean {
  const file = path.join(dir, ROOM_TO_START_FILE)
  let free: number
  try {
    free = freeBytes(dir)
  } catch {
    return false
  }
  const kept = fs.existsSync(file)
  if (free < FULL_BELOW_BYTES) {
    if (!kept) return false
    fs.rmSync(file, { force: true })
    return true
  }
  if (!kept && free >= FULL_BELOW_BYTES + ROOM_TO_START_BYTES) {
    // Written out, not made sparse: room only counts if it is really taken.
    const partial = `${file}.partial`
    try {
      fs.writeFileSync(partial, Buffer.alloc(ROOM_TO_START_BYTES))
      fs.renameSync(partial, file)
    } catch {
      fs.rmSync(partial, { force: true })
    }
  }
  return false
}

function bytesFreeAt(dir: string): number {
  const stats = fs.statfsSync(dir)
  return stats.bavail * stats.bsize
}
