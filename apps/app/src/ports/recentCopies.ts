import { Directory, File, Paths } from 'expo-file-system'
import type { Song } from '@selfmp3/shared'
import {
  budgetForDisk,
  fileNameFor,
  parseKeptFiles,
  serialiseKeptFiles,
  toEvict,
  type KeptFile,
} from '@selfmp3/client'

import { prefs } from './prefs'
import { sourceFor } from './songSource'

/**
 * Songs kept because they were played, on a phone: files in the cache folder.
 *
 * A phone streams a cloud song it has not downloaded (`ports/bucketMedia.ts`),
 * which is the point of a phone short of room — and would mean fetching the
 * same twenty songs from the bucket every day. So a song that counts as a play
 * is kept, up to a budget, and the least recently played copies are let go to
 * make room. The budget and the choice of what goes are the shared ones
 * (`@selfmp3/client`, recentCopies); this only keeps, finds and deletes.
 *
 * These are a cache, not downloads, and live apart from them on purpose:
 *
 *  - In the OS's cache folder, not the documents one. The system may clear it
 *    when the phone is full, which is exactly what should happen to a copy
 *    nobody asked for, and it is left out of the device's backup.
 *  - Out of the download index, so they never count as "on this device": a mark
 *    that can disappear on its own is worse than none. Asking for the song by
 *    hand turns its copy into a download (`adoptRecent`).
 *
 * The rules for when to keep one are the caller's (`DownloadsProvider`: only a
 * cloud library, not a song removed by hand).
 */

const RECENT_KEY = 'recent-audio-files'
const RECENT_DIRECTORY = 'recent-songs'
/** A copy still arriving. Never played and never counted: only a whole file is renamed into place. */
const PARTIAL_SUFFIX = '.part'

type SongFile = Pick<Song, 'id' | 'path'>

function directory(): Directory {
  return new Directory(Paths.cache, RECENT_DIRECTORY)
}

/**
 * The note, read once. Whether a song can play is asked of every song in a
 * queue at a time — a thousand, shuffling a library with no signal — and
 * parsing the same JSON a thousand times to answer it is a pause somebody
 * would feel. Nothing else writes this key, so what is in memory is the note.
 */
let note: Map<number, KeptFile> | null = null

function load(): Map<number, KeptFile> {
  note ??= parseKeptFiles(prefs.get(RECENT_KEY))
  return note
}

function save(kept: Map<number, KeptFile>): void {
  note = kept
  prefs.set(RECENT_KEY, serialiseKeptFiles(kept))
}

/** The songs held only because they were played. */
export function recentIds(): ReadonlySet<number> {
  return new Set(load().keys())
}

/**
 * A kept copy's address, for the player, or null when there is none.
 *
 * Asks the disk rather than trusting the note: the system clears this folder
 * without telling anyone, and a `file://` address with nothing behind it would
 * be played as silence in place of a song that could have streamed.
 */
export function recentUri(songId: number): string | null {
  const entry = load().get(songId)
  if (!entry) return null
  const file = new File(directory(), entry.fileName)
  return file.exists ? file.uri : null
}

/**
 * Asked for by hand. Nothing to do yet, and the doing nothing matters: the copy
 * has to still be here when the download runs, which is when it is moved into
 * place rather than fetched again (`adoptRecent`). Forgetting it now would
 * delete the very file the download is about to want.
 */
export function promoteRecent(_songIds: readonly number[]): void {}

/** Removed by hand: no longer this budget's to count, and no longer here. */
export function forgetRecent(songIds: readonly number[]): void {
  const kept = load()
  let changed = false
  for (const songId of songIds) {
    const entry = kept.get(songId)
    if (!entry) continue
    remove(entry.fileName)
    kept.delete(songId)
    changed = true
  }
  if (changed) save(kept)
}

export function clearRecent(): void {
  try {
    const dir = directory()
    if (dir.exists) dir.delete()
  } catch {
    // Nothing to clear, or not ours to: the note below is what stops it being used.
  }
  save(new Map())
}

/** Being fetched now, so a song played twice in a row is not fetched twice. */
const arriving = new Set<number>()

/**
 * Keep the song that just counted as a play.
 *
 * Called as the play is counted, not at the end, so the copy is usually there
 * before the track is — and the next play is from the disk. The song is
 * streaming while this runs, which makes it the second request for the same
 * file; that is the price of a player that cannot hand over what it buffered,
 * and it is paid once per song rather than once per play.
 */
export async function keepRecentlyPlayed(song: SongFile): Promise<void> {
  if (arriving.has(song.id)) return
  arriving.add(song.id)
  try {
    const kept = load()
    const fileName = fileNameFor(song)
    const file = new File(directory(), fileName)
    const known = kept.get(song.id)
    if (known && file.exists) {
      kept.set(song.id, { ...known, playedAt: Date.now() })
      save(kept)
      return
    }

    const bytes = await fetchInto(song, file)
    if (bytes === null) return
    kept.set(song.id, { playedAt: Date.now(), fileName, bytes })
    trim(kept)
  } catch {
    // No room, no signal, the bucket unreachable: the song played regardless,
    // and the next play tries again.
  } finally {
    arriving.delete(song.id)
  }
}

/**
 * A kept copy, moved to where a download belongs, and its size — or null when
 * there is none to move.
 *
 * Asking for a song by hand turns its copy into a download. The bytes are the
 * same bytes, so fetching them again would be a second trip to the bucket to
 * replace a file with itself.
 */
export async function adoptRecent(song: SongFile, destination: File): Promise<number | null> {
  const kept = load()
  const entry = kept.get(song.id)
  if (!entry) return null
  const file = new File(directory(), entry.fileName)
  kept.delete(song.id)
  save(kept)
  if (!file.exists) return null
  const bytes = file.size ?? entry.bytes
  await file.move(destination)
  return bytes
}

/** The whole file, or nothing: fetched beside its name and renamed once complete. */
async function fetchInto(song: SongFile, file: File): Promise<number | null> {
  directory().create({ intermediates: true, idempotent: true })
  const partial = new File(directory(), `${fileNameFor(song)}${PARTIAL_SUFFIX}`)
  if (partial.exists) partial.delete()
  try {
    // Signed in is the only case this is called in, so there is no server to name.
    const from = await sourceFor(song, null)
    const task = File.createDownloadTask(from.url, partial, {
      ...(from.headers ? { headers: from.headers } : {}),
      // Foreground, for the reason the download queue gives (downloadStorage.ts).
      sessionType: 'foreground',
    })
    const finished = await task.downloadAsync()
    if (finished === null) return null
    if (file.exists) file.delete()
    await partial.move(file)
    return file.size ?? finished.size ?? 0
  } finally {
    if (partial.exists) partial.delete()
  }
}

/** Let go of the oldest copies until the rest fit, and write down what is left. */
function trim(kept: Map<number, KeptFile>): void {
  let held = 0
  for (const [songId, entry] of kept) {
    // Gone already: cleared by the system under pressure.
    if (!new File(directory(), entry.fileName).exists) kept.delete(songId)
    else held += entry.bytes
  }
  const copies = [...kept].map(([songId, entry]) => ({
    songId,
    playedAt: entry.playedAt,
    bytes: entry.bytes,
  }))
  for (const songId of toEvict(copies, budgetForDisk(freeBytes(), held))) {
    const entry = kept.get(songId)
    if (entry) remove(entry.fileName)
    kept.delete(songId)
  }
  save(kept)
}

function freeBytes(): number | null {
  try {
    return Paths.availableDiskSpace
  } catch {
    return null
  }
}

function remove(fileName: string): void {
  try {
    const file = new File(directory(), fileName)
    if (file.exists) file.delete()
  } catch {
    // Already gone, which is what was wanted.
  }
}
