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

import { prefs } from './prefs'
import { sourceFor } from './songSource'

/**
 * Songs kept because they were played, as files: the rules, for a phone's
 * cache folder (`recentCopies.ts`) and the desktop shell's `recent` folder
 * (`desktop/recentCopies.desktop.ts`) alike. A browser keeps its copies in the
 * Cache API instead and has rules of its own (`recentCopies.web.ts`).
 *
 * The two used to be two copies of this, and a fix to one missed the other: a
 * desktop refused to hand a download a copy of a song whose audio had since
 * changed, while a phone moved the old audio into place and played it. Here
 * there is one rule for that, and every step follows it: a copy is the song's
 * only while its name is the name the song's audio has now (`fileNameFor`, the
 * hash of the bytes in the bucket). One that is not is stale — dropped from the
 * note, and its file deleted — wherever it is met.
 *
 * The budget and the choice of what goes are the shared ones (`@selfmp3/client`,
 * recentCopies); a folder only keeps, finds and deletes.
 */

const RECENT_KEY = 'recent-audio-files'

type SongFile = Pick<Song, 'id' | 'path'>

/** Where the files are, and the little each platform does differently with them. */
interface RecentFolder<Destination> {
  /**
   * Where the player can play a copy from, or null when it is not there. A
   * phone asks its disk each time, because the system clears its cache folder
   * without telling anyone; a desktop trusts the note, checked once a launch.
   */
  address(fileName: string): string | null
  has(fileName: string): Promise<boolean>
  /** Every whole copy in the folder, by name. */
  list(): Promise<readonly string[]>
  /** The whole file under this name and its size, or null when it did not arrive. */
  fetch(
    fileName: string,
    url: string,
    headers: Record<string, string> | undefined,
  ): Promise<number | null>
  /** A copy moved to where downloads live, under the same name, and its size — or null when there was none. */
  move(fileName: string, destination: Destination): Promise<number | null>
  /** Best effort: already gone is what was wanted. */
  delete(fileName: string): void
  clear(): void
  /** Free space on the disk, or null when it will not say. */
  free(): Promise<number | null>
  /**
   * Where to fetch a song's copy from, when this platform has somewhere better
   * than the bucket: the desktop shell has the song it just streamed on its
   * disk already. Left out, the bucket through the doorman (`sourceFor`).
   */
  source?(song: SongFile): { url: string; headers?: Record<string, string> }
}

export interface RecentCopies<Destination> {
  /** The songs held only because they were played. */
  recentIds(): ReadonlySet<number>
  /** A kept copy's address, for the player, or null when there is none of this song's audio. */
  recentUri(song: SongFile | undefined): string | null
  /**
   * Asked for by hand. Nothing to do yet, and the doing nothing matters: the
   * copy has to still be here when the download runs, which is when it is
   * moved into place rather than fetched again (`adoptRecent`). Forgetting it
   * now would delete the very file the download is about to want.
   */
  promoteRecent(songIds: readonly number[]): void
  /** Removed by hand: no longer this budget's to count, and no longer here. */
  forgetRecent(songIds: readonly number[]): void
  clearRecent(): void
  keepRecentlyPlayed(song: SongFile): Promise<void>
  /**
   * The player's own stream of a song begun (a phone's `songStream.ts`): when
   * it is whole (`arrived`), it is kept as played now, not when it landed.
   */
  streaming(songId: number): void
  /**
   * A copy the player's own stream brought whole: the play already paid for
   * the bytes, so it is kept as if fetched for it — unless the song was removed
   * by hand while it arrived.
   */
  arrived(song: SongFile, bytes: number): Promise<void>
  /**
   * A kept copy, moved to where a download belongs, and its size — or null
   * when there is none to move. Asking for a song by hand turns its copy into
   * a download: the same bytes, so not a second trip to the bucket.
   */
  adoptRecent(song: SongFile, destination: Destination): Promise<number | null>
}

export function createRecentCopies<Destination>(
  folder: RecentFolder<Destination>,
): RecentCopies<Destination> {
  /**
   * The note, read once. Whether a song can play is asked of every song in a
   * queue at a time — a thousand, shuffling a library with no signal — and
   * parsing the same JSON a thousand times to answer it is a pause somebody
   * would feel. Nothing else writes this key, so what is in memory is the note.
   */
  let note: Map<number, KeptFile> | null = null

  function load(): Map<number, KeptFile> {
    if (note === null) {
      note = parseKeptFiles(prefs.get(RECENT_KEY))
      void reconcile(new Map(note))
    }
    return note
  }

  function save(kept: Map<number, KeptFile>): void {
    note = kept
    prefs.set(RECENT_KEY, serialiseKeptFiles(kept))
  }

  /**
   * The note against the folder, once a launch: a person can empty it in
   * Finder, and the system can clear a phone's. Only entries still as they
   * were when the folder was asked are dropped, so a copy that arrives while
   * the listing is on its way is not forgotten for not being in it.
   */
  async function reconcile(before: ReadonlyMap<number, KeptFile>): Promise<void> {
    try {
      const present = new Set(await folder.list())
      const kept = load()
      let changed = false
      for (const [songId, entry] of before) {
        if (present.has(entry.fileName) || kept.get(songId) !== entry) continue
        kept.delete(songId)
        changed = true
      }
      if (changed) save(kept)
    } catch {
      // The folder would not say; the note stands until the next launch asks.
    }
  }

  /** Off the note and off the disk. */
  function drop(kept: Map<number, KeptFile>, songId: number): void {
    const entry = kept.get(songId)
    if (!entry) return
    folder.delete(entry.fileName)
    kept.delete(songId)
  }

  /** The note's copy of a song, if it is of the audio the song has now. */
  function current(song: SongFile): KeptFile | null {
    const entry = load().get(song.id)
    return entry && entry.fileName === fileNameFor(song) ? entry : null
  }

  /**
   * Let go of the oldest copies until the rest fit, and write down what is
   * left. Copies gone already — cleared by the system under pressure, or by
   * hand — are dropped first, by the same rule as at launch: two songs land
   * together (the one playing and the next, fetched ahead), and one written
   * down while the folder was being asked must not be lost for not being in
   * the listing.
   */
  async function trim(): Promise<void> {
    await reconcile(new Map(load()))
    const free = await folder.free()
    const kept = load()
    let held = 0
    for (const entry of kept.values()) held += entry.bytes
    const copies = [...kept].map(([songId, entry]) => ({
      songId,
      playedAt: entry.playedAt,
      bytes: entry.bytes,
    }))
    for (const songId of toEvict(copies, budgetForDisk(free, held))) {
      drop(kept, songId)
    }
    save(kept)
  }

  /** Being fetched now, so a song played twice in a row is not fetched twice. */
  const arriving = new Set<number>()

  /**
   * When each song still arriving was last asked for: what it is kept as,
   * once whole. A song another play overtook while it arrived is the older
   * of the two, and one asked for again in that time the newer (the desktop
   * shell's rule, apps/desktop/src/main/stream.ts). Forgotten when the song is
   * removed by hand, which is how a copy that lands after that is let go.
   */
  const asked = new Map<number, number>()

  /**
   * A whole copy, written down as played when it was last asked for — or let
   * go, when it was removed by hand since: neither asked for any more nor in
   * the note already (the fetch and the stream's word of the same download
   * both land here, and the second finds the first's entry).
   */
  async function settle(song: SongFile, fileName: string, bytes: number): Promise<void> {
    const kept = load()
    const known = kept.get(song.id)
    const playedAt = asked.get(song.id) ?? (known?.fileName === fileName ? known.playedAt : null)
    asked.delete(song.id)
    if (playedAt === null) {
      folder.delete(fileName)
      return
    }
    // Of audio the song no longer has: not this copy, and not to be kept beside it.
    if (known && known.fileName !== fileName) drop(kept, song.id)
    kept.set(song.id, { playedAt, fileName, bytes })
    try {
      await trim()
    } catch {
      // The folder would not say; the note stands, and the next copy trims.
      save(kept)
    }
  }

  return {
    recentIds: () => new Set(load().keys()),

    recentUri(song) {
      const entry = song ? current(song) : null
      return entry ? folder.address(entry.fileName) : null
    },

    promoteRecent: () => undefined,

    forgetRecent(songIds) {
      const kept = load()
      let changed = false
      for (const songId of songIds) {
        // Still arriving: not kept once it lands (`settle`).
        asked.delete(songId)
        if (!kept.has(songId)) continue
        drop(kept, songId)
        changed = true
      }
      if (changed) save(kept)
    },

    clearRecent() {
      folder.clear()
      asked.clear()
      save(new Map())
    },

    /**
     * Called as the play is counted, not at the end, so the copy is usually
     * there before the track is — and the next play is from the disk. Where
     * the song streams from one download into this folder (a phone's
     * `songStream.ts`), the fetch joins that download or finds it done, and
     * the bucket is asked once. Where it does not — the desktop's shell
     * hands over its own — this is the second request for the same file,
     * paid once per song rather than once per play.
     */
    async keepRecentlyPlayed(song) {
      asked.set(song.id, Date.now())
      if (arriving.has(song.id)) return
      arriving.add(song.id)
      try {
        const kept = load()
        const fileName = fileNameFor(song)
        const known = kept.get(song.id)
        if (known?.fileName === fileName && (await folder.has(fileName))) {
          kept.set(song.id, { ...known, playedAt: asked.get(song.id) ?? Date.now() })
          asked.delete(song.id)
          save(kept)
          return
        }
        // Of audio the song no longer has, or gone from the disk: neither is
        // this song's copy, and an old one must not be played as the new.
        if (known) {
          drop(kept, song.id)
          save(kept)
        }
        // The bucket refusing for the day: the song plays from the stream, and is kept another time.
        if (bucketHold('read')) return
        // Signed in is the only case this is called in, so there is no server to name.
        const from = folder.source?.(song) ?? (await sourceFor(song, null))
        const bytes = await folder.fetch(fileName, from.url, from.headers)
        if (bytes === null) return
        await settle(song, fileName, bytes)
      } catch {
        // No room, no signal, the bucket unreachable: the song played regardless,
        // and the next play tries again.
      } finally {
        arriving.delete(song.id)
      }
    },

    streaming(songId) {
      asked.set(songId, Date.now())
    },

    arrived: (song, bytes) => settle(song, fileNameFor(song), bytes),

    async adoptRecent(song, destination) {
      const kept = load()
      const entry = kept.get(song.id)
      if (!entry) return null
      kept.delete(song.id)
      save(kept)
      // Stale: the download is of the audio the song has now, which this is not.
      if (entry.fileName !== fileNameFor(song)) {
        folder.delete(entry.fileName)
        return null
      }
      return folder.move(entry.fileName, destination)
    },
  }
}
