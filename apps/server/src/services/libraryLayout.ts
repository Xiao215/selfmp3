import fsp from 'node:fs/promises'
import path from 'node:path'
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
