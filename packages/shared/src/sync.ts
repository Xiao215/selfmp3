import { MISSING_TAG_UID } from './cloud.js'
import { hlcTime, hlcWins, parseHlc } from './hlc.js'
import { CLOUD_FORMAT } from './schemas/cloud.js'
import type {
  CloudImport,
  CloudPlaylist,
  CloudSnapshot,
  CloudSong,
  CloudTag,
} from './schemas/cloud.js'
import { SONG_FIELDS } from './schemas/song.js'
import {
  ChangeSchema,
  LOG_FORMAT,
  LogFileSchema,
  type Change,
  type LogFile,
} from './schemas/sync.js'

/**
 * Replaying the change log (docs/SYNC.md): the rules for combining changes,
 * whichever device made them and in whatever order they arrive.
 *
 * - A field takes its value from the change with the latest stamp. A change
 *   older than the one that last set the field arrives late, and loses.
 * - A tag on a song, and a song in a playlist, work the same way: the latest
 *   of "on" and "off" wins, so a tag taken off after it was put on stays off.
 * - Making something is a change of its own, and removing it is for good. A
 *   change to something that is not there is ignored, so a late edit never
 *   brings a deleted playlist back.
 * - Plays and skips only add up, and the same one twice counts once.
 *
 * Since the latest stamp wins whenever a change is applied, the same changes
 * give every device the same library. The Mac applies these rules to its
 * database (apps/server/src/services/cloudIngest.ts), and a test holds the two
 * to the same answers.
 */

/** A library being replayed into: a snapshot, taken apart so changes can land in it. */
export interface SyncLibrary {
  readonly songs: Map<string, CloudSong>
  readonly tags: Map<string, CloudTag>
  readonly playlists: Map<string, CloudPlaylist>
  /** A tag made twice under one name: the second uid, and the tag it was folded into. */
  readonly aliases: Map<string, string>
  /** Links asked to be imported, and how each went. */
  readonly imports: Map<string, CloudImport>
  /** Plays and skips counted during this replay, by id. */
  readonly counted: Set<string>
}

export function syncLibrary(snapshot?: CloudSnapshot | null): SyncLibrary {
  return {
    songs: new Map(snapshot?.songs.map(song => [song.uid, song])),
    tags: new Map(snapshot?.tags.map(tag => [tag.uid, tag])),
    playlists: new Map(snapshot?.playlists.map(playlist => [playlist.uid, playlist])),
    aliases: new Map(Object.entries(snapshot?.aliases ?? {})),
    imports: new Map(snapshot?.imports?.map(request => [request.uid, request])),
    counted: new Set(),
  }
}

/** A copy to replay into without touching the original. Things in it are never changed in place. */
export function copySyncLibrary(library: SyncLibrary): SyncLibrary {
  return {
    songs: new Map(library.songs),
    tags: new Map(library.tags),
    playlists: new Map(library.playlists),
    aliases: new Map(library.aliases),
    imports: new Map(library.imports),
    counted: new Set(library.counted),
  }
}

export function snapshotOf(
  library: SyncLibrary,
  meta: { writtenAt: string; writtenBy: string; upTo: Readonly<Record<string, number>> },
): CloudSnapshot {
  return {
    format: CLOUD_FORMAT,
    writtenAt: meta.writtenAt,
    writtenBy: meta.writtenBy,
    upTo: { ...meta.upTo },
    songs: [...library.songs.values()],
    tags: [...library.tags.values()],
    playlists: [...library.playlists.values()],
    ...(library.aliases.size > 0 ? { aliases: Object.fromEntries(library.aliases) } : {}),
    ...(library.imports.size > 0 ? { imports: [...library.imports.values()] } : {}),
  }
}

/** Changes in the order they are replayed: by stamp, which is the order they win in. */
export function compareChanges(a: Change, b: Change): number {
  return a.hlc < b.hlc ? -1 : a.hlc > b.hlc ? 1 : 0
}

/** Replay changes in stamp order. Returns how many changed something. */
export function applyChanges(library: SyncLibrary, changes: Iterable<Change>): number {
  let changed = 0
  for (const change of [...changes].sort(compareChanges)) {
    if (applyChange(library, change)) changed++
  }
  return changed
}

/** Apply one change. True when it changed anything, a stamp included. */
export function applyChange(library: SyncLibrary, change: Change): boolean {
  switch (change.type) {
    case 'songEdited': {
      const song = library.songs.get(change.uid)
      if (!song) return false
      const next: Record<string, unknown> = { ...song }
      const stamps = { ...song.stamps }
      let changed = false
      for (const field of SONG_FIELDS) {
        const value = change.fields[field]
        if (value === undefined || !hlcWins(change.hlc, stamps[field])) continue
        next[field] = value
        stamps[field] = change.hlc
        changed = true
      }
      if (!changed) return false
      library.songs.set(song.uid, { ...(next as CloudSong), stamps })
      return true
    }

    case 'songTagged': {
      const song = library.songs.get(change.uid)
      const tagUid = resolveTag(library, change.tagUid)
      if (!song || !library.tags.has(tagUid)) return false
      if (!hlcWins(change.hlc, song.tagStamps?.[tagUid])) return false
      const has = song.tagUids.includes(tagUid)
      library.songs.set(song.uid, {
        ...song,
        tagUids: change.on
          ? has
            ? song.tagUids
            : [...song.tagUids, tagUid]
          : song.tagUids.filter(uid => uid !== tagUid),
        tagStamps: { ...song.tagStamps, [tagUid]: change.hlc },
      })
      return true
    }

    case 'songRemoved': {
      if (!library.songs.delete(change.uid)) return false
      for (const playlist of library.playlists.values()) {
        const inIt = playlist.songUids.includes(change.uid)
        const stamped = playlist.songStamps?.[change.uid] !== undefined
        if (!inIt && !stamped) continue
        library.playlists.set(playlist.uid, {
          ...playlist,
          songUids: playlist.songUids.filter(uid => uid !== change.uid),
          ...withoutKey('songStamps', playlist.songStamps, change.uid),
        })
      }
      return true
    }

    case 'songPlayed': {
      const song = library.songs.get(change.uid)
      if (!song || library.counted.has(change.playId)) return false
      library.counted.add(change.playId)
      /*
       * No later than the change that reports it.
       *
       * A play cannot have happened after the moment it was written down, and
       * `lastPlayedAt` only ever moves forward — so one bad timestamp, from a
       * clock briefly wrong or a device that woke up confused, would stick and
       * no real play could ever displace it. Clamped against the change's own
       * stamp rather than against the wall clock, because every device has to
       * replay this log to the same library; reading the time here would make
       * the answer depend on when it was read.
       */
      const at = toSqliteTime(Math.min(Date.parse(change.playedAt), hlcTime(change.hlc)))
      library.songs.set(song.uid, {
        ...song,
        playCount: song.playCount + 1,
        lastPlayedAt: song.lastPlayedAt === null || song.lastPlayedAt < at ? at : song.lastPlayedAt,
      })
      return true
    }

    case 'songSkipped': {
      const song = library.songs.get(change.uid)
      if (!song || library.counted.has(change.skipId)) return false
      library.counted.add(change.skipId)
      library.songs.set(song.uid, { ...song, skipCount: song.skipCount + 1 })
      return true
    }

    case 'tagCreated': {
      if (library.tags.has(change.uid) || library.aliases.has(change.uid)) return false
      // The same name made on two devices before either heard of the other:
      // one tag, not two that look alike.
      const same = tagNamed(library, change.name)
      if (same) library.aliases.set(change.uid, same.uid)
      else library.tags.set(change.uid, { uid: change.uid, name: change.name, hue: change.hue })
      return true
    }

    case 'tagEdited': {
      const uid = resolveTag(library, change.uid)
      const tag = library.tags.get(uid)
      if (!tag) return false
      const next = { ...tag }
      const stamps = { ...tag.stamps }
      let changed = false
      const { name, hue } = change.fields
      // A name another tag already has is left alone: names are how tags are
      // told apart, and the Mac's database holds them to it.
      if (name !== undefined && hlcWins(change.hlc, stamps['name'])) {
        const same = tagNamed(library, name)
        if (!same || same.uid === uid) {
          next.name = name
          stamps['name'] = change.hlc
          changed = true
        }
      }
      if (hue !== undefined && hlcWins(change.hlc, stamps['hue'])) {
        next.hue = hue
        stamps['hue'] = change.hlc
        changed = true
      }
      if (!changed) return false
      library.tags.set(uid, { ...next, stamps })
      return true
    }

    case 'tagRemoved': {
      const uid = resolveTag(library, change.uid)
      if (!library.tags.delete(uid)) return false
      for (const [alias, target] of library.aliases) {
        if (target === uid) library.aliases.delete(alias)
      }
      for (const song of library.songs.values()) {
        const tagged = song.tagUids.includes(uid)
        const stamped = song.tagStamps?.[uid] !== undefined
        if (!tagged && !stamped) continue
        library.songs.set(song.uid, {
          ...song,
          tagUids: song.tagUids.filter(tagUid => tagUid !== uid),
          ...withoutKey('tagStamps', song.tagStamps, uid),
        })
      }
      // A smart rule about the tag keeps meaning what it did: "has" matches
      // nothing now, "does not have" everything.
      for (const playlist of library.playlists.values()) {
        if (!playlist.rules?.rules.some(rule => rule.field === 'tag' && rule.tagUid === uid)) {
          continue
        }
        library.playlists.set(playlist.uid, {
          ...playlist,
          rules: resolveRules(library, playlist.rules),
        })
      }
      return true
    }

    case 'playlistCreated': {
      if (library.playlists.has(change.uid)) return false
      const when = toSqliteTime(hlcTime(change.hlc))
      library.playlists.set(change.uid, {
        uid: change.uid,
        name: change.name,
        description: change.description,
        kind: change.kind,
        rules: change.kind === 'smart' ? resolveRules(library, change.rules) : null,
        pinned: change.pinned,
        songUids: [],
        createdAt: when,
        updatedAt: when,
      })
      return true
    }

    case 'playlistEdited': {
      const playlist = library.playlists.get(change.uid)
      if (!playlist) return false
      const next: Record<string, unknown> = { ...playlist }
      const stamps = { ...playlist.stamps }
      let changed = false
      for (const field of ['name', 'description', 'rules', 'pinned'] as const) {
        const value = change.fields[field]
        if (value === undefined || !hlcWins(change.hlc, stamps[field])) continue
        next[field] = field === 'rules' ? resolveRules(library, change.fields.rules ?? null) : value
        stamps[field] = change.hlc
        changed = true
      }
      if (!changed) return false
      library.playlists.set(playlist.uid, {
        ...(next as CloudPlaylist),
        stamps,
        updatedAt: laterTime(playlist.updatedAt, change.hlc),
      })
      return true
    }

    case 'playlistRemoved':
      return library.playlists.delete(change.uid)

    case 'playlistSong': {
      const playlist = library.playlists.get(change.uid)
      if (!playlist || playlist.kind !== 'manual' || !library.songs.has(change.songUid)) {
        return false
      }
      if (!hlcWins(change.hlc, playlist.songStamps?.[change.songUid])) return false
      const has = playlist.songUids.includes(change.songUid)
      library.playlists.set(playlist.uid, {
        ...playlist,
        songUids: change.on
          ? has
            ? playlist.songUids
            : [...playlist.songUids, change.songUid]
          : playlist.songUids.filter(uid => uid !== change.songUid),
        songStamps: { ...playlist.songStamps, [change.songUid]: change.hlc },
        updatedAt: laterTime(playlist.updatedAt, change.hlc),
      })
      return true
    }

    case 'importRequested': {
      if (library.imports.has(change.uid)) return false
      const when = toSqliteTime(hlcTime(change.hlc))
      library.imports.set(change.uid, {
        uid: change.uid,
        url: change.url,
        requestedBy: parseHlc(change.hlc)?.device ?? 'unknown',
        requestedAt: when,
        state: 'waiting',
        title: null,
        songUids: [],
        error: null,
        updatedAt: when,
      })
      return true
    }

    case 'importCancelled': {
      const request = library.imports.get(change.uid)
      if (!request || (request.state !== 'waiting' && request.state !== 'working')) return false
      library.imports.set(request.uid, {
        ...request,
        state: 'cancelled',
        updatedAt: laterTime(request.updatedAt, change.hlc),
      })
      return true
    }

    case 'playlistOrdered': {
      const playlist = library.playlists.get(change.uid)
      if (!playlist || playlist.kind !== 'manual') return false
      if (!hlcWins(change.hlc, playlist.stamps?.['order'])) return false
      library.playlists.set(playlist.uid, {
        ...playlist,
        songUids: reordered(playlist.songUids, change.songUids),
        stamps: { ...playlist.stamps, order: change.hlc },
        updatedAt: laterTime(playlist.updatedAt, change.hlc),
      })
      return true
    }
  }
}

/**
 * A new order for a playlist: the songs named, in that order, then any it has
 * that were not named, in the order they were in. Songs named that it does
 * not have are ignored, and so is a song named twice after the first time.
 */
export function reordered(current: readonly string[], order: readonly string[]): string[] {
  const present = new Set(current)
  const placed = new Set<string>()
  const first: string[] = []
  for (const uid of order) {
    if (!present.has(uid) || placed.has(uid)) continue
    placed.add(uid)
    first.push(uid)
  }
  return [...first, ...current.filter(uid => !placed.has(uid))]
}

/** The tag a uid means now: itself, or the tag it was folded into. */
export function resolveTag(library: Pick<SyncLibrary, 'aliases'>, uid: string): string {
  let current = uid
  for (let hops = 0; hops < 4; hops++) {
    const target = library.aliases.get(current)
    if (target === undefined) return current
    current = target
  }
  return current
}

/**
 * Names compare the way the Mac's database compares them: ignoring the case
 * of A–Z, and only of A–Z.
 */
export function sameTagName(a: string, b: string): boolean {
  return asciiLower(a) === asciiLower(b)
}

export function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, char => char.toLowerCase())
}

function tagNamed(library: SyncLibrary, name: string): CloudTag | null {
  for (const tag of library.tags.values()) {
    if (sameTagName(tag.name, name)) return tag
  }
  return null
}

/**
 * Rules naming each tag as it is now: an alias by the tag it was folded into,
 * and a tag that is not in the library by `MISSING_TAG_UID` — as the Mac's
 * database, which keeps a tag's id and not its uid, would have it.
 */
function resolveRules(library: SyncLibrary, rules: CloudPlaylist['rules']): CloudPlaylist['rules'] {
  if (!rules) return null
  return {
    ...rules,
    rules: rules.rules.map(rule => {
      if (rule.field !== 'tag') return rule
      const tagUid = resolveTag(library, rule.tagUid)
      return { ...rule, tagUid: library.tags.has(tagUid) ? tagUid : MISSING_TAG_UID }
    }),
  }
}

/** `{ [key]: rest }` with one entry gone, or the key dropped when nothing is left. */
function withoutKey<K extends string>(
  key: K,
  stamps: Readonly<Record<string, string>> | undefined,
  entry: string,
): { [P in K]?: Record<string, string> } {
  const rest = { ...stamps }
  delete rest[entry]
  return (Object.keys(rest).length > 0 ? { [key]: rest } : { [key]: undefined }) as {
    [P in K]?: Record<string, string>
  }
}

/** SQLite's own UTC format, `2026-09-11 14:22:05`, which the Mac's times are in. */
export function toSqliteTime(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
}

function laterTime(time: string, hlc: string): string {
  const stamped = toSqliteTime(hlcTime(hlc))
  return stamped > time ? stamped : time
}

// --- Log files -------------------------------------------------------------------

export function logFile(
  device: string,
  seq: number,
  changes: readonly Change[],
  writtenAt: Date,
): LogFile {
  return { format: LOG_FORMAT, device, seq, writtenAt: writtenAt.toISOString(), changes }
}

export type ReadLog =
  | { readonly ok: true; readonly file: LogFile; readonly skipped: number }
  | { readonly ok: false; readonly reason: 'unreadable' | 'newer' }

/**
 * A log file as it came from the bucket. Changes this build does not know are
 * counted in `skipped` rather than failing the file — a device can show the
 * rest — but the Mac, which folds changes in for good, stops at such a file
 * until it is updated.
 */
export function readLogFile(json: unknown): ReadLog {
  const parsed = LogFileSchema.safeParse(json)
  if (!parsed.success) return { ok: false, reason: 'unreadable' }
  if (parsed.data.format > LOG_FORMAT) return { ok: false, reason: 'newer' }
  const changes: Change[] = []
  let skipped = 0
  for (const raw of parsed.data.changes) {
    const change = ChangeSchema.safeParse(raw)
    if (change.success) changes.push(change.data)
    else skipped++
  }
  return { ok: true, file: { ...parsed.data, changes }, skipped }
}
