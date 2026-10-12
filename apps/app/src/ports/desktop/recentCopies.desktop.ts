import type { Song } from '@selfmp3/shared'
import { bucketHold } from '@selfmp3/replica'
import {
  budgetForDisk,
  fileNameFor,
  parseKeptFiles,
  serialiseKeptFiles,
  toEvict,
  type KeptFile,
} from '@selfmp3/client'

import { prefs } from '../prefs'
import { sourceFor } from '../songSource'
import { desktop } from './bridge'

/**
 * Songs kept because they were played, in the installed desktop app: files in
 * the shell's `recent` folder — the phone's arrangement (`ports/recentCopies.ts`),
 * through the bridge.
 *
 * The browser's way, the Cache API, does not work on the app's own `app://`
 * page, so without this a computer signed in to the cloud fetched the same
 * songs from the bucket every day. The budget and the choice of what goes are
 * the shared ones (`@selfmp3/client`, recentCopies); this only keeps, finds and
 * deletes.
 *
 * A folder of its own, apart from `songs`, so a copy never counts as "on this
 * computer" and Settings' usage leaves it out. Asking for the song by hand
 * moves its copy into `songs` (`adoptRecent`) instead of fetching it again.
 */

const RECENT_KEY = 'recent-audio-files'
const KIND = 'recent'

type SongFile = Pick<Song, 'id' | 'path'>

/** The note, read once: whether a song can play is asked of every song in a queue. */
let note: Map<number, KeptFile> | null = null

function load(): Map<number, KeptFile> {
  if (note === null) {
    note = parseKeptFiles(prefs.get(RECENT_KEY))
    void reconcile()
  }
  return note
}

function save(kept: Map<number, KeptFile>): void {
  note = kept
  prefs.set(RECENT_KEY, serialiseKeptFiles(kept))
}

/**
 * The note against the folder, once a launch. Nothing but this file writes
 * there, but a person can empty it in Finder, and an address with nothing
 * behind it would play as an error where the song could have streamed.
 */
async function reconcile(): Promise<void> {
  if (!desktop) return
  try {
    const present = new Set((await desktop.files.list(KIND)).map(file => file.name))
    const kept = load()
    let changed = false
    for (const [songId, entry] of kept) {
      if (present.has(entry.fileName)) continue
      kept.delete(songId)
      changed = true
    }
    if (changed) save(kept)
  } catch {
    // The shell would not say; the note stands until the next launch asks.
  }
}

function recentIds(): ReadonlySet<number> {
  return new Set(load().keys())
}

function recentUri(songId: number): string | null {
  const entry = load().get(songId)
  return entry && desktop ? desktop.mediaUrl(KIND, entry.fileName) : null
}

/**
 * Asked for by hand. Nothing to do yet: the copy has to still be here when the
 * download runs, which is when it is moved into place (`adoptRecent`).
 */
function promoteRecent(_songIds: readonly number[]): void {}

function forgetRecent(songIds: readonly number[]): void {
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

function clearRecent(): void {
  void desktop?.files.clear(KIND).catch(() => undefined)
  save(new Map())
}

/** Being fetched now, so a song played twice in a row is not fetched twice. */
const arriving = new Set<number>()
let nextId = 0

/**
 * Keep the song that just counted as a play. Called as the play is counted, so
 * the copy is usually there before the track is over.
 */
async function keepRecentlyPlayed(song: SongFile): Promise<void> {
  const bridge = desktop
  if (!bridge || arriving.has(song.id)) return
  // The bucket refusing for the day: the song plays from the stream, and is kept another time.
  if (bucketHold('read')) return
  arriving.add(song.id)
  try {
    const kept = load()
    const known = kept.get(song.id)
    if (known) {
      kept.set(song.id, { ...known, playedAt: Date.now() })
      save(kept)
      return
    }
    const fileName = fileNameFor(song)
    // Signed in is the only case this is called in, so there is no server to name.
    const from = await sourceFor(song, null)
    const result = await bridge.files.download({
      id: `recent-${song.id}-${++nextId}`,
      kind: KIND,
      name: fileName,
      url: from.url,
      ...(from.headers ? { headers: from.headers } : {}),
    })
    if (result.state !== 'done') return
    kept.set(song.id, { playedAt: Date.now(), fileName, bytes: result.bytes })
    await trim(kept)
  } catch {
    // No room, no signal, the bucket unreachable: the song played regardless,
    // and the next play tries again.
  } finally {
    arriving.delete(song.id)
  }
}

/**
 * A kept copy, moved to where a download belongs, and its size — or null when
 * there is none to move. The same bytes, so not a second trip to the bucket.
 */
export async function adoptRecent(song: SongFile): Promise<number | null> {
  const kept = load()
  const entry = kept.get(song.id)
  if (!entry || !desktop) return null
  kept.delete(song.id)
  save(kept)
  // The download's name, which is the copy's: both are `fileNameFor(song)`.
  if (entry.fileName !== fileNameFor(song)) {
    remove(entry.fileName)
    return null
  }
  const moved = await desktop.files.move(KIND, 'songs', entry.fileName)
  return moved?.bytes ?? null
}

/** Let go of the oldest copies until the rest fit, and write down what is left. */
async function trim(kept: Map<number, KeptFile>): Promise<void> {
  let held = 0
  for (const entry of kept.values()) held += entry.bytes
  const copies = [...kept].map(([songId, entry]) => ({
    songId,
    playedAt: entry.playedAt,
    bytes: entry.bytes,
  }))
  for (const songId of toEvict(copies, budgetForDisk(await freeBytes(), held))) {
    const entry = kept.get(songId)
    if (entry) remove(entry.fileName)
    kept.delete(songId)
  }
  save(kept)
}

async function freeBytes(): Promise<number | null> {
  try {
    return (await desktop?.files.usage())?.free ?? null
  } catch {
    return null
  }
}

function remove(fileName: string): void {
  // Already gone is what was wanted.
  void desktop?.files.delete(KIND, fileName).catch(() => undefined)
}

export const desktopRecentCopies = {
  recentIds,
  recentUri,
  promoteRecent,
  forgetRecent,
  clearRecent,
  keepRecentlyPlayed,
}
