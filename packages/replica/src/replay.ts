import {
  applyChanges,
  parseLogKey,
  livePlaylistSongs,
  snapshotOf,
  syncLibrary,
  type Change,
  type CloudSnapshot,
  type LogFile,
  type SyncLibrary,
} from '@selfmp3/shared'

/**
 * What this device shows (docs/SYNC.md): the newest snapshot, with every
 * change it has not folded in yet replayed on top — other devices' logs,
 * this device's own, and what this device has not managed to upload yet.
 * Pure, so it can be tested without a browser.
 */

export function replay(
  base: CloudSnapshot | null,
  logs: Iterable<LogFile>,
  local: readonly Change[],
): SyncLibrary {
  const library = syncLibrary(base)
  applyChanges(library, [...[...logs].flatMap(file => file.changes), ...local])
  return library
}

/**
 * The replayed library as a snapshot, with each live playlist's songs worked
 * out from its rules here — so loving a song adds it to a playlist of loved
 * songs straight away, rather than when the server next publishes.
 */
export function replayedSnapshot(
  library: SyncLibrary,
  base: CloudSnapshot | null,
  now = Date.now(),
): CloudSnapshot {
  const snapshot = snapshotOf(library, {
    writtenAt: base?.writtenAt ?? new Date(now).toISOString(),
    writtenBy: base?.writtenBy ?? 'none',
    upTo: base?.upTo ?? {},
  })
  const songs = snapshot.songs
  return {
    ...snapshot,
    // Where the server listens is the snapshot's alone: no change carries it, so
    // it is taken from the base as written, or the device would never learn it.
    ...(base?.server ? { server: base.server } : {}),
    playlists: snapshot.playlists.map(playlist =>
      playlist.kind === 'live' && playlist.rules
        ? {
            ...playlist,
            // A shuffled playlist keeps its order between edits: the same
            // seed each time, rather than a reshuffle whenever a song is loved.
            songUids: inKeptOrder(
              playlist.songUids,
              livePlaylistSongs(playlist.rules, songs, {
                now,
                random: seeded(playlist.uid),
              }),
            ),
          }
        : playlist,
    ),
  }
}

/**
 * The rule's answer, in the order it was put in by hand.
 *
 * A playlist that follows tags can be reordered (`edits.reorderPlaylist`), and
 * what that writes is the playlist's own `songUids`. The rule still decides
 * *which* songs; the hand order decides the order of the ones it names, and
 * whatever the rule has matched since — which the order has never heard of —
 * follows at the end. The same shape the server keeps (`repositories/playlists.ts`).
 */
function inKeptOrder(kept: readonly string[], matched: readonly string[]): string[] {
  if (kept.length === 0) return [...matched]
  const place = new Map(kept.map((uid, at) => [uid, at]))
  const known: string[] = []
  const rest: string[] = []
  for (const uid of matched) (place.has(uid) ? known : rest).push(uid)
  known.sort((a, b) => (place.get(a) ?? 0) - (place.get(b) ?? 0))
  return [...known, ...rest]
}

/** The latest stamp anywhere in a snapshot: where this device's clock must go past. */
export function latestStamp(snapshot: CloudSnapshot | null): string | null {
  let latest: string | null = null
  const see = (stamps: Readonly<Record<string, string>> | undefined): void => {
    for (const hlc of Object.values(stamps ?? {})) if (latest === null || hlc > latest) latest = hlc
  }
  for (const song of snapshot?.songs ?? []) {
    see(song.stamps)
    see(song.tagStamps)
  }
  for (const tag of snapshot?.tags ?? []) see(tag.stamps)
  for (const playlist of snapshot?.playlists ?? []) {
    see(playlist.stamps)
    see(playlist.songStamps)
  }
  return latest
}

/**
 * This device's log files that a snapshot has folded in, and so are no longer
 * needed by anyone. Another device's files are never this one's to delete.
 */
export function foldedOwnLogs(
  keys: readonly string[],
  deviceId: string,
  upTo: Readonly<Record<string, number>>,
): string[] {
  const reached = upTo[deviceId] ?? 0
  return keys.filter(key => {
    const parsed = parseLogKey(key)
    return parsed?.deviceId === deviceId && parsed.seq <= reached
  })
}

/** A repeatable stream of numbers in [0, 1) from a string: mulberry32 over its hash. */
function seeded(seed: string): () => number {
  let state = 0
  for (let i = 0; i < seed.length; i++) state = (Math.imul(state, 31) + seed.charCodeAt(i)) | 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
