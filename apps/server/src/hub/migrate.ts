import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import type { Config } from '../config.js'
import type { Logger } from '../logger.js'
import type { FileThrottleStore } from '../shared.js'
import { HubRegistry } from './registry.js'

/**
 * A server from before workspaces, made into one with a single workspace
 * (docs/features/shared-server.md).
 *
 * It had one library, in the data folder itself: `selfmp3.db` and the caches
 * beside it, the inbox in the library folder. They move, as they are, into
 * the folders of a workspace of their own, and `hub.json` says whose. The
 * database keeps everything it knew — its plays, its uploads' bookkeeping, its
 * doorman session — so the library goes on exactly where it was, and its token
 * is carried into `hub.json` so no device has to be told a new one.
 *
 * Which account it is for is not known here: the database holds the session,
 * not the account's id, and asking the doorman is the hub's business once it
 * is running (`Hub`, "settling"). Moved, not copied: a rename within one disk,
 * and nothing left behind to be mistaken for a second library.
 */

/** What a workspace's data folder holds, and nothing else of the data folder's. */
const MOVED = [
  'selfmp3.db',
  'selfmp3.db-wal',
  'selfmp3.db-shm',
  'covers',
  'lyrics',
  'motion',
  'artists',
  'cloud-files',
  'incoming',
] as const

/** Whether this data folder holds a library from before, and nothing says whose yet. */
export function hasLibraryFromBefore(config: Pick<Config, 'dataDir' | 'cloudDir'>): boolean {
  return (
    config.cloudDir === null &&
    !HubRegistry.exists(config.dataDir) &&
    fs.existsSync(path.join(config.dataDir, 'selfmp3.db'))
  )
}

export function migrateLibraryFromBefore(
  config: Pick<Config, 'dataDir' | 'libraryDir' | 'authToken'>,
  registry: HubRegistry,
  throttle: FileThrottleStore,
  logger: Logger,
): void {
  const old = readOld(path.join(config.dataDir, 'selfmp3.db'))
  if (old.throttle) throttle.save(old.throttle)

  const entry = registry.add({
    account: null,
    email: old.session?.email ?? null,
    // A token chosen by hand was the one devices had.
    token: config.authToken ?? old.token ?? undefined,
    grant: old.session ? { token: old.session.token, id: null } : null,
  })

  const dataDir = path.join(config.dataDir, 'accounts', entry.id)
  fs.mkdirSync(dataDir, { recursive: true })
  for (const name of MOVED) {
    const from = path.join(config.dataDir, name)
    if (fs.existsSync(from)) fs.renameSync(from, path.join(dataDir, name))
  }

  // The inbox: whatever was waiting in it is that library's.
  const libraryDir = path.join(config.libraryDir, entry.id)
  fs.mkdirSync(libraryDir, { recursive: true })
  for (const name of fs.readdirSync(config.libraryDir)) {
    if (name === entry.id) continue
    fs.renameSync(path.join(config.libraryDir, name), path.join(libraryDir, name))
  }

  logger.info('the library from before is now a workspace', {
    workspace: entry.id,
    account: old.session?.email ?? 'not signed in',
  })
}

interface OldLibrary {
  readonly token: string | null
  readonly session: { readonly token: string; readonly email: string } | null
  readonly throttle: Parameters<FileThrottleStore['save']>[0] | null
}

/**
 * What the old database knew that the hub keeps outside it: read, and closed
 * again. Opened for writing on purpose — closing folds the write-ahead log back
 * into the file, so what moves is one whole database.
 */
function readOld(file: string): OldLibrary {
  const db = new Database(file, { fileMustExist: true })
  try {
    const secret = (name: string): string | null => {
      try {
        return (
          db
            .prepare<[string], { value: string }>('SELECT value FROM secrets WHERE name = ?')
            .get(name)?.value ?? null
        )
      } catch {
        return null
      }
    }
    let session: OldLibrary['session'] = null
    const saved = secret('cloud.doorman')
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as { token?: unknown; email?: unknown }
        if (typeof parsed.token === 'string') {
          session = {
            token: parsed.token,
            email: typeof parsed.email === 'string' ? parsed.email : '',
          }
        }
      } catch {
        // Not one this build wrote: as good as not signed in.
      }
    }
    let throttle: OldLibrary['throttle'] = null
    try {
      const row = db
        .prepare<
          [],
          {
            tokens: number
            ratchet: number
            updated_at: number
            paused_until: number
            limited_at: number
          }
        >('SELECT * FROM yt_throttle WHERE id = 1')
        .get()
      if (row) {
        throttle = {
          tokens: row.tokens,
          ratchet: row.ratchet,
          updatedAt: row.updated_at,
          pausedUntil: row.paused_until,
          limitedAt: row.limited_at,
        }
      }
    } catch {
      // A database too old to pace YouTube: the hub's pace starts afresh.
    }
    return { token: secret('server.token'), session, throttle }
  } finally {
    db.close()
  }
}
