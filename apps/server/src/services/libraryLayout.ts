import fsp from 'node:fs/promises'
import path from 'node:path'
import { LYRIC_EXTENSIONS } from '@selfmp3/shared'
import type { Logger } from '../logger.js'
import type { SongRepository } from '../repositories/songs.js'
import type { StorageDriver } from '../storage/index.js'

/**
 * Where imported songs live on disk.
 *
 * Each import gets a folder of its own, named like the file inside it:
 *
 *   library/YOASOBI - 群青/YOASOBI - 群青.m4a
 *   library/YOASOBI - 群青/YOASOBI - 群青.lrc
 *
 * so the audio and its lyrics sit together, and the library reads as a list of
 * songs rather than one heap of files. Files you put in the library yourself
 * stay wherever you put them: the scanner walks every folder.
 */

/** A song's own folder, with the file inside named the same. */
export function songKey(name: string, extension: string): string {
  return `${name}/${name}${extension}`
}

/**
 * Keys to try for a new song, best first. A second song of the same name gets
 * `Name (2)/Name (2).m4a`, never a file slipped into the first one's folder:
 * lyrics are found by the audio file's name, so two songs sharing a folder and
 * a name would share lyrics too.
 */
export function* songKeyCandidates(name: string, extension: string): Generator<string> {
  yield songKey(name, extension)
  for (let n = 2; n < 100; n++) yield songKey(`${name} (${n})`, extension)
  yield songKey(`${name} (${Date.now()})`, extension)
}

/** Neither the folder nor the file is there yet. */
export async function isFreeOnDisk(storage: StorageDriver, key: string): Promise<boolean> {
  return !(await storage.exists(path.posix.dirname(key))) && !(await storage.exists(key))
}

/**
 * How imports used to be named: straight into the library root, with the
 * import job's id on the end — `YOASOBI - 群青 [bdba990f].m4a`. No slash
 * anywhere: a file already in a folder is where someone meant it to be.
 */
const LEGACY_IMPORT = /^([^/]+) \[[0-9a-f]{8}\](\.[^./]+)$/

/**
 * Move songs imported before they had folders into folders of their own,
 * dropping the job id from the name on the way.
 *
 * Only files the importer named are touched; anything else in the root was
 * put there by hand and stays put. Runs before the first scan of a boot, and
 * each song's path is updated as its file lands, because the scanner knows
 * songs by path: a file that moved without its row would come back as a new
 * song and leave the old one, tags and plays and all, marked missing.
 */
export async function organizeLegacyImports(deps: {
  storage: StorageDriver
  songs: SongRepository
  logger: Logger
}): Promise<number> {
  const { storage, songs, logger } = deps
  let moved = 0

  for (const key of await storage.list()) {
    const match = LEGACY_IMPORT.exec(key)
    if (!match) continue
    const [, name = '', extension = ''] = match

    try {
      let target: string | null = null
      for (const candidate of songKeyCandidates(name, extension)) {
        // A missing song's row can still hold a path whose file is gone.
        if (songs.byPath(candidate)) continue
        if (await isFreeOnDisk(storage, candidate)) {
          target = candidate
          break
        }
      }
      if (!target) continue

      const song = songs.byPath(key)
      await storage.move(key, target)
      if (song) songs.setPath(song.id, target)
      moved++

      // The lyrics go with it, renamed to match, or they would not be found.
      const fromStem = key.slice(0, -extension.length)
      const toStem = target.slice(0, -extension.length)
      for (const lyric of LYRIC_EXTENSIONS) {
        if (await storage.exists(fromStem + lyric)) {
          await storage.move(fromStem + lyric, toStem + lyric)
        }
      }
    } catch (error) {
      logger.warn('could not move a song into its own folder', {
        key,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (moved > 0) logger.info('moved imported songs into folders of their own', { count: moved })
  return moved
}

/**
 * After a song's files are deleted, remove the folder it was in, if that
 * leaves it empty. Finder's `.DS_Store` does not count as something left.
 * Object storage has no folders, so there is nothing to do there.
 */
export async function removeFolderIfEmpty(storage: StorageDriver, key: string): Promise<void> {
  const folder = path.posix.dirname(key)
  if (folder === '.') return
  const local = storage.localPath(folder)
  if (!local) return

  try {
    const left = await fsp.readdir(local)
    if (left.some(name => name !== '.DS_Store')) return
    await fsp.rm(path.join(local, '.DS_Store'), { force: true })
    await fsp.rmdir(local)
  } catch {
    // Already gone, or something else got there first: either way, not ours.
  }
}
