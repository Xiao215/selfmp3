import {
  CLOUD_FORMAT,
  CloudSnapshotSchema,
  toCloudRules,
  type CloudPlaylist,
  type CloudSnapshot,
  type CloudSong,
  type Playlist,
  type Song,
  type Tag,
} from '@selfmp3/shared'
import type { CloudSongState } from '../repositories/cloud.js'
import type { ImportRequest } from '../repositories/importRequests.js'
import type { StampRow } from '../repositories/sync.js'

/**
 * The library as a snapshot for the bucket (docs/SYNC.md): pure, so what goes
 * out can be tested without a bucket or a server.
 *
 * Only songs whose audio is uploaded are in it. A song whose file has gone
 * missing on this Mac since is still in it — the bucket has its audio, which
 * is the point of having one — until the song is forgotten for good.
 */
export interface SnapshotInput {
  readonly songs: readonly Song[]
  readonly songUids: ReadonlyMap<number, string>
  readonly states: ReadonlyMap<number, CloudSongState>
  readonly tags: readonly Tag[]
  readonly tagUids: ReadonlyMap<number, string>
  readonly playlists: readonly Playlist[]
  readonly playlistUids: ReadonlyMap<number, string>
  /** Song ids in playlist order; live playlists resolved as they stand. */
  readonly playlistSongIds: (playlist: Playlist) => readonly number[]
  readonly deviceId: string
  readonly writtenAt: Date
  /** When each edited field was last set (docs/SYNC.md), so later changes combine with it. */
  readonly stamps?: readonly StampRow[]
  /** Second uids for tags made twice under one name, and the tag each means. */
  readonly aliases?: ReadonlyMap<string, string>
  /** How far into each device's log this library has read. */
  readonly upTo?: Readonly<Record<string, number>>
  /** Links other devices asked to import lately, and how each went. */
  readonly imports?: readonly ImportRequest[]
}

type Stamps = Record<string, string>

/** Stamps grouped by what they are about: kind, then uid, then field. */
function groupStamps(rows: readonly StampRow[]): Map<string, Map<string, Stamps>> {
  const byKind = new Map<string, Map<string, Stamps>>()
  for (const row of rows) {
    let byUid = byKind.get(row.kind)
    if (!byUid) byKind.set(row.kind, (byUid = new Map<string, Stamps>()))
    let fields = byUid.get(row.uid)
    if (!fields) byUid.set(row.uid, (fields = {}))
    fields[row.field] = row.hlc
  }
  return byKind
}

/** Only the entries whose key passes, or nothing at all when none do. */
function kept(stamps: Stamps | undefined, keep: (key: string) => boolean): Stamps | undefined {
  if (!stamps) return undefined
  const entries = Object.entries(stamps).filter(([key]) => keep(key))
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

export function buildSnapshot(input: SnapshotInput): CloudSnapshot {
  const songs: CloudSong[] = []
  const published = new Map<number, string>()
  const stamps = groupStamps(input.stamps ?? [])
  const stampsOf = (kind: StampRow['kind'], uid: string): Stamps | undefined =>
    stamps.get(kind)?.get(uid)
  const tagUidSet = new Set(input.tagUids.values())

  for (const song of input.songs) {
    const state = input.states.get(song.id)
    const uid = input.songUids.get(song.id)
    if (!state || !uid) continue
    published.set(song.id, uid)

    songs.push({
      uid,
      title: song.title,
      artist: song.artist,
      album: song.album,
      albumArtist: song.albumArtist,
      trackNo: song.trackNo,
      year: song.year,
      duration: song.duration,
      audio: { key: state.audioKey, size: state.audioSize, mime: song.mime },
      cover: state.coverKey !== null ? { key: state.coverKey, size: state.coverSize ?? 0 } : null,
      // The cover's colour, when there is a cover to be the colour of and it has
      // been read. Left out otherwise, as an older snapshot would.
      ...(state.coverKey !== null && song.coverTone ? { coverTone: song.coverTone } : {}),
      lyrics:
        state.lyricsKey !== null && state.lyricsKind !== null
          ? {
              key: state.lyricsKey,
              size: state.lyricsSize ?? 0,
              kind: state.lyricsKind,
              romanized: state.romanizedKey,
            }
          : null,
      instrumental: song.instrumental,
      loved: song.loved,
      playCount: song.playCount,
      skipCount: song.skipCount,
      lastPlayedAt: song.lastPlayedAt,
      addedAt: song.addedAt,
      sourceUrl: song.sourceUrl,
      tagUids: song.tagIds.flatMap(id => {
        const tagUid = input.tagUids.get(id)
        return tagUid ? [tagUid] : []
      }),
      features: song.features,
      ...optional('stamps', stampsOf('song', uid)),
      ...optional(
        'tagStamps',
        kept(stampsOf('songTag', uid), tagUid => tagUidSet.has(tagUid)),
      ),
    })
  }
  const publishedUids = new Set(published.values())

  const tagUid = (id: number): string | null => input.tagUids.get(id) ?? null

  const playlists: CloudPlaylist[] = []
  for (const playlist of input.playlists) {
    const uid = input.playlistUids.get(playlist.id)
    if (!uid) continue
    playlists.push({
      uid,
      name: playlist.name,
      description: playlist.description,
      kind: playlist.kind,
      rules:
        playlist.kind === 'live' && playlist.rules ? toCloudRules(playlist.rules, tagUid) : null,
      pinned: playlist.pinned,
      songUids: input.playlistSongIds(playlist).flatMap(id => {
        const songUid = published.get(id)
        return songUid ? [songUid] : []
      }),
      createdAt: playlist.createdAt,
      updatedAt: playlist.updatedAt,
      ...optional('stamps', stampsOf('playlist', uid)),
      ...optional(
        'songStamps',
        kept(stampsOf('playlistSong', uid), songUid => publishedUids.has(songUid)),
      ),
    })
  }
  const aliases = [...(input.aliases ?? [])].filter(([, target]) => tagUidSet.has(target))

  // Parsed on the way out as well as on the way in: a snapshot another device
  // would reject is a bug here, and it should fail here, loudly.
  return CloudSnapshotSchema.parse({
    format: CLOUD_FORMAT,
    writtenAt: input.writtenAt.toISOString(),
    writtenBy: input.deviceId,
    upTo: { ...input.upTo },
    songs,
    tags: input.tags.flatMap(tag => {
      const uid = input.tagUids.get(tag.id)
      return uid
        ? [{ uid, name: tag.name, hue: tag.hue, ...optional('stamps', stampsOf('tag', uid)) }]
        : []
    }),
    playlists,
    ...(aliases.length > 0 ? { aliases: Object.fromEntries(aliases) } : {}),
    ...(input.imports && input.imports.length > 0
      ? {
          imports: input.imports.map(request => ({
            uid: request.uid,
            url: request.url,
            requestedBy: request.requestedBy,
            requestedAt: request.requestedAt,
            state: request.state,
            title: request.title,
            songUids: [...request.songUids],
            error: request.error,
            updatedAt: request.updatedAt,
          })),
        }
      : {}),
  })
}

/** `{ [key]: value }`, or nothing when there is no value: most things carry no stamps. */
function optional<K extends string>(key: K, value: Stamps | undefined): { [P in K]?: Stamps } {
  return (value ? { [key]: value } : {}) as { [P in K]?: Stamps }
}

// --- Publishing over somebody else's library ---------------------------------

/**
 * The smallest library worth protecting. Below this, "half the songs are gone"
 * is one deleted song, and refusing would be noise.
 */
const GUARD_MIN_SONGS = 8

/** How much of a library may vanish in one snapshot before this objects. */
const GUARD_MAX_LOSS = 0.5

/**
 * Should this device refuse to replace the library in the bucket?
 *
 * The Mac only ever *writes* snapshots — it has never read one — and the newest
 * snapshot is what every other device adopts. So a Mac that comes up holding
 * less than the bucket knows about will quietly publish its own sparse database
 * as the whole library, and every phone and browser will follow it. That is not
 * hypothetical: it is what a reinstall, a restored backup, a half-finished
 * first scan, or a second Mac signed in to the same account all look like.
 *
 * Today the audio survives, because nothing deletes from the bucket. Once
 * anything does, this becomes permanent, so the refusal wants to exist first.
 *
 * This is deliberately not clever. It does not try to work out *why* the count
 * fell; it declines to be the one that throws the songs away, says so, and
 * leaves a person to decide. Deleting most of your library on purpose is rare
 * and something you would rather confirm than have happen silently.
 */
export function publishWouldLoseLibrary(inBucket: number, onThisDevice: number): boolean {
  if (inBucket < GUARD_MIN_SONGS) return false
  if (onThisDevice >= inBucket) return false
  return onThisDevice < inBucket * GUARD_MAX_LOSS
}

/** What to tell somebody whose Mac just declined to publish. */
export function publishRefusedMessage(inBucket: number, onThisDevice: number): string {
  return (
    `refused to publish: the bucket's library has ${inBucket} songs and this Mac has ` +
    `${onThisDevice}. Publishing would have replaced the first with the second on every ` +
    `device. If this Mac is still scanning, wait; if it was reinstalled or restored, let it ` +
    `finish syncing before publishing. To publish anyway, set SELFMP3_PUBLISH_ANYWAY=1.`
  )
}
