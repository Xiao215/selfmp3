import fs from 'node:fs'
import path from 'node:path'

/**
 * Incremental backup of a folder tree.
 *
 * The rule is deliberately simple: a file is copied when the destination is
 * missing, a different size, or older. No hashing — a music library is big and
 * mostly immutable, so size + mtime catches everything that matters and keeps a
 * nightly run to seconds.
 */

export interface FileStamp {
  readonly size: number
  readonly mtimeMs: number
}

/** Pure decision: does `src` need copying over `dest`? */
export function shouldCopy(src: FileStamp, dest: FileStamp | null): boolean {
  if (dest === null) return true
  if (dest.size !== src.size) return true
  // Filesystems round mtimes differently (HFS+ to the second, APFS to the ns),
  // so a copy made a moment ago can look a hair older than its source.
  return src.mtimeMs - dest.mtimeMs > 2000
}

/** SQLite's journal and shared-memory files are never copied; the backup API handles the db itself. */
export function isSqliteScratch(name: string): boolean {
  return name.endsWith('-wal') || name.endsWith('-shm') || name.endsWith('-journal')
}

export function isSqliteDatabase(name: string): boolean {
  return name.endsWith('.db') || name.endsWith('.sqlite')
}

export interface BackupSummary {
  files: number
  copied: number
  bytes: number
  copiedBytes: number
}

async function stampOf(file: string): Promise<FileStamp | null> {
  try {
    const stat = await fs.promises.stat(file)
    return stat.isFile() ? { size: stat.size, mtimeMs: stat.mtimeMs } : null
  } catch {
    return null
  }
}

/**
 * Copy a database with SQLite's online backup API rather than `cp`, so the
 * copy is consistent even while the server is writing to it. Loaded lazily:
 * every other file in a backup is plain bytes and does not need the module.
 */
async function backupDatabase(src: string, dest: string): Promise<void> {
  const { default: Database } = await import('better-sqlite3')
  const db = new Database(src, { readonly: true })
  try {
    await db.backup(dest)
  } finally {
    db.close()
  }
}

/** Mirror `srcDir` into `destDir`, copying only what changed. Never deletes. */
export async function backupTree(
  srcDir: string,
  destDir: string,
  onCopy: (relative: string) => void = () => undefined,
): Promise<BackupSummary> {
  const summary: BackupSummary = { files: 0, copied: 0, bytes: 0, copiedBytes: 0 }
  const databases: string[] = []

  await fs.promises.cp(srcDir, destDir, {
    recursive: true,
    preserveTimestamps: true,
    filter: async (src, dest) => {
      const srcStamp = await stampOf(src)
      if (srcStamp === null) return true // a directory: descend

      const name = path.basename(src)
      if (isSqliteScratch(name)) return false
      if (isSqliteDatabase(name)) {
        databases.push(path.relative(srcDir, src))
        return false
      }

      summary.files += 1
      summary.bytes += srcStamp.size
      if (!shouldCopy(srcStamp, await stampOf(dest))) return false

      summary.copied += 1
      summary.copiedBytes += srcStamp.size
      onCopy(path.relative(srcDir, src))
      return true
    },
  })

  // Databases always get a fresh, consistent copy — they are small and the
  // mtime rule cannot tell whether a WAL checkpoint has landed.
  for (const relative of databases) {
    const src = path.join(srcDir, relative)
    const dest = path.join(destDir, relative)
    await fs.promises.mkdir(path.dirname(dest), { recursive: true })
    await backupDatabase(src, dest)
    const size = (await stampOf(src))?.size ?? 0
    summary.files += 1
    summary.bytes += size
    summary.copied += 1
    summary.copiedBytes += size
    onCopy(relative)
  }

  return summary
}
