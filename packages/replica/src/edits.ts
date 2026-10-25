import {
  findArtist,
  insertedAt,
  newTagHue,
  newUid,
  noSongsProblem,
  playlistPatchProblem,
  playlistSongsProblem,
  tagFlips,
  tagNamed,
  tagRenameProblem,
  tagsEmptiedBy,
  tidyArtistNames,
  toCloudRules,
  type Change,
  type CreatePlaylist,
  type Playlist,
  type PlayEvent,
  type SetArtistNames,
  type Song,
  type SongPatch,
  type UpdatePlaylist,
} from '@selfmp3/shared'
import { CloudRouteError, notFound, refused } from './errors.js'
import type { CloudLibrary } from './snapshotLibrary.js'

/**
 * Edits made on this device, as the changes that go in its log (docs/SYNC.md).
 *
 * Each takes the library as this device shows it, by the ids the app uses,
 * and says what changed, by uid. The replica applies them here at once and
 * uploads them; every other device replays them. Pure — the clock, new uids
 * and the time are handed in — and held to the rules the server's routes are
 * (shared editRules.ts), so an edit the server would refuse is refused here
 * too, before it is recorded, in the same words.
 */
export interface EditContext {
  readonly view: CloudLibrary
  /** A stamp for each change, from this device's clock. */
  readonly stamp: () => string
  readonly newUid?: () => string
  readonly now?: () => Date
  /** Plays this device has counted already, by id: one sent again is not recorded twice. */
  readonly counted?: ReadonlySet<string>
}

const make = (ctx: EditContext): string => (ctx.newUid ?? newUid)()
const nowOf = (ctx: EditContext): Date => ctx.now?.() ?? new Date()

function songUid(ctx: EditContext, id: number): string {
  const uid = ctx.view.uids.songs.get(id)
  if (!uid) throw notFound('song')
  return uid
}

function tagUid(ctx: EditContext, id: number): string {
  const uid = ctx.view.uids.tags.get(id)
  if (!uid) throw notFound('tag')
  return uid
}

function song(ctx: EditContext, id: number): Song {
  const found = ctx.view.byId.songs.get(id)
  if (!found) throw notFound('song')
  return found
}

function playlist(ctx: EditContext, id: number): Playlist & { uid: string } {
  const found = ctx.view.byId.playlists.get(id)
  const uid = ctx.view.uids.playlists.get(id)
  if (!found || !uid) throw notFound('playlist')
  return { ...found, uid }
}

/**
 * The songs of these ids this device has, each once, with its uid. A song gone
 * since the screen was drawn is left out rather than refused, as the server
 * does for a list.
 */
function knownSongs(ctx: EditContext, ids: readonly number[]): [number, string][] {
  return [...new Set(ids)].flatMap(id => {
    const uid = ctx.view.uids.songs.get(id)
    return uid ? [[id, uid] as [number, string]] : []
  })
}

/** A playlist songs can be put into by hand, as the server's routes hold one to. */
function manual(ctx: EditContext, id: number): Playlist & { uid: string } {
  const found = playlist(ctx, id)
  const problem = playlistSongsProblem(found.kind)
  if (problem) throw refused(problem)
  return found
}

// --- Songs -----------------------------------------------------------------------

export function editSong(ctx: EditContext, id: number, patch: SongPatch): Change[] {
  return [{ type: 'songEdited', hlc: ctx.stamp(), uid: songUid(ctx, id), fields: patch }]
}

/** Loved or not, for every song asked about that is still here. */
export function loveSongs(ctx: EditContext, ids: readonly number[], loved: boolean): Change[] {
  return knownSongs(ctx, ids).map(([, uid]) => ({
    type: 'songEdited' as const,
    hlc: ctx.stamp(),
    uid,
    fields: { loved },
  }))
}

/** A song's tags, all at once: the ones that go on, and the ones that come off. */
export function setSongTags(ctx: EditContext, id: number, tagIds: readonly number[]): Change[] {
  const current = song(ctx, id)
  const uid = songUid(ctx, id)
  // Tags that are gone are dropped quietly, as the server does for a stale phone.
  const { on, off } = tagFlips(
    current.tagIds,
    tagIds.filter(tagId => ctx.view.uids.tags.has(tagId)),
  )
  const flips = [
    ...on.map(tagId => ({ tagId, on: true })),
    ...off.map(tagId => ({ tagId, on: false })),
  ]
  return flips.map(({ tagId, on }) => ({
    type: 'songTagged' as const,
    hlc: ctx.stamp(),
    uid,
    tagUid: tagUid(ctx, tagId),
    on,
  }))
}

/** One tag on, or off, many songs. */
export function tagSongs(
  ctx: EditContext,
  tagId: number,
  songIds: readonly number[],
  on: boolean,
): Change[] {
  const tag = tagUid(ctx, tagId)
  return knownSongs(ctx, songIds).map(([, uid]) => ({
    type: 'songTagged' as const,
    hlc: ctx.stamp(),
    uid,
    tagUid: tag,
    on,
  }))
}

/**
 * Out of the library, on every device — with each tag only these songs had,
 * as the server's own removal takes them (`tagsEmptiedBy`).
 */
export function removeSongs(ctx: EditContext, ids: readonly number[]): Change[] {
  const known = knownSongs(ctx, ids)
  const emptied = tagsEmptiedBy(
    ctx.view.library.tags,
    known.flatMap(([id]) => ctx.view.byId.songs.get(id) ?? []),
  )
  return [
    ...known.map(([, uid]) => ({ type: 'songRemoved' as const, hlc: ctx.stamp(), uid })),
    ...emptied.map(id => ({ type: 'tagRemoved' as const, hlc: ctx.stamp(), uid: tagUid(ctx, id) })),
  ]
}

/**
 * Copies of one song folded into the one kept (`songMerged`, docs/SYNC.md):
 * the shared rule moves each copy's tags, love, playlist places and plays to
 * it, here and on every device that replays the change, and the server moves
 * the copy's play history with it. A copy that is gone, or the kept song
 * itself, is left out; a kept song that is gone makes nothing, which the
 * route answers as nothing merged — as the server's `SongMerge.merge` does.
 */
export function mergeSongs(ctx: EditContext, keep: number, ids: readonly number[]): Change[] {
  const into = ctx.view.uids.songs.get(keep)
  if (!into) return []
  return knownSongs(ctx, ids)
    .filter(([id]) => id !== keep)
    .map(([, uid]) => ({ type: 'songMerged' as const, hlc: ctx.stamp(), uid, into }))
}

/**
 * A play, or nothing when this device has counted it already: the play
 * outbox sends one again when the answer to it was lost, and the server
 * answers that as a duplicate too.
 */
export function playSong(ctx: EditContext, id: number, event: PlayEvent): Change[] {
  const uid = songUid(ctx, id)
  if (event.clientId && ctx.counted?.has(event.clientId)) return []
  return [
    {
      type: 'songPlayed',
      hlc: ctx.stamp(),
      uid,
      // The play outbox's own id, so a play sent twice still counts once.
      playId: event.clientId ?? make(ctx),
      playedAt: event.playedAt ?? nowOf(ctx).toISOString(),
      msPlayed: event.msPlayed,
      completed: event.completed,
    },
  ]
}

// --- Tags ------------------------------------------------------------------------

/**
 * A new tag — or the one that already has the name, as the server does, so two
 * taps of "create chill" make one tag.
 */
export function createTag(
  ctx: EditContext,
  name: string,
  hue: number | undefined,
): { changes: Change[]; uid: string } {
  const existing = tagNamed(ctx.view.library.tags, name)
  if (existing) return { changes: [], uid: tagUid(ctx, existing.id) }
  const uid = make(ctx)
  return {
    changes: [{ type: 'tagCreated', hlc: ctx.stamp(), uid, name, hue: newTagHue(name, hue) }],
    uid,
  }
}

export function editTag(
  ctx: EditContext,
  id: number,
  fields: { name?: string | undefined; hue?: number | undefined },
): Change[] {
  const uid = tagUid(ctx, id)
  const clash = tagRenameProblem(ctx.view.library.tags, id, fields.name)
  if (clash) throw refused(clash)
  return [
    {
      type: 'tagEdited',
      hlc: ctx.stamp(),
      uid,
      fields: {
        ...(fields.name !== undefined ? { name: fields.name } : {}),
        ...(fields.hue !== undefined ? { hue: fields.hue } : {}),
      },
    },
  ]
}

export function removeTag(ctx: EditContext, id: number): Change[] {
  return [{ type: 'tagRemoved', hlc: ctx.stamp(), uid: tagUid(ctx, id) }]
}

// --- Artists ---------------------------------------------------------------------

/** The names an artist also goes by, all of them as they should be now. */
export function nameArtist(
  ctx: EditContext,
  artist: string,
  names: readonly string[],
): { changes: Change[]; named: SetArtistNames } {
  const found = findArtist(ctx.view.library.songs, artist)
  if (!found) throw notFound('artist')
  const named = { artist: found.key, names: tidyArtistNames(found.name, names) }
  return { changes: [{ type: 'artistNamed', hlc: ctx.stamp(), ...named }], named }
}

// --- Playlists -------------------------------------------------------------------

const cloudRules = (ctx: EditContext, rules: NonNullable<CreatePlaylist['rules']>) =>
  toCloudRules(rules, id => ctx.view.uids.tags.get(id) ?? null)

export function createPlaylist(
  ctx: EditContext,
  input: CreatePlaylist,
): { changes: Change[]; uid: string } {
  const uid = make(ctx)
  // Its first songs with it, in the same record of changes, as the server makes them.
  const first = input.kind === 'manual' ? knownSongs(ctx, input.songIds ?? []) : []
  return {
    changes: [
      {
        type: 'playlistCreated',
        hlc: ctx.stamp(),
        uid,
        kind: input.kind,
        name: input.name,
        description: input.description,
        rules: input.kind === 'live' ? cloudRules(ctx, input.rules) : null,
        pinned: false,
      },
      ...first.map(([, songUid]) => ({
        type: 'playlistSong' as const,
        hlc: ctx.stamp(),
        uid,
        songUid,
        on: true,
      })),
    ],
    uid,
  }
}

export function editPlaylist(ctx: EditContext, id: number, patch: UpdatePlaylist): Change[] {
  const found = playlist(ctx, id)
  const problem = playlistPatchProblem(found.kind, patch)
  if (problem) throw refused(problem)
  return [
    {
      type: 'playlistEdited',
      hlc: ctx.stamp(),
      uid: found.uid,
      fields: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
        ...(patch.rules !== undefined
          ? { rules: patch.rules ? cloudRules(ctx, patch.rules) : null }
          : {}),
      },
    },
  ]
}

/**
 * Stop a playlist following its tags, keeping the songs it shows here now, in
 * that order — what the server's own Stop following keeps. A playlist that
 * follows nothing is left as it is, and that is not an error: the asker
 * wanted one that does not follow tags, and there it is.
 */
export function stopFollowing(ctx: EditContext, id: number): Change[] {
  const found = playlist(ctx, id)
  if (found.kind !== 'live') return []
  return [
    {
      type: 'playlistUnfollowed',
      hlc: ctx.stamp(),
      uid: found.uid,
      songUids: (ctx.view.playlistSongs[id] ?? []).map(songId => songUid(ctx, songId)),
    },
  ]
}

export function removePlaylist(ctx: EditContext, id: number): Change[] {
  return [{ type: 'playlistRemoved', hlc: ctx.stamp(), uid: playlist(ctx, id).uid }]
}

/** Songs into a manual playlist: at the end, or at `position` — which is a new order too. */
export function addToPlaylist(
  ctx: EditContext,
  id: number,
  songIds: readonly number[],
  position: number | undefined,
): Change[] {
  const found = manual(ctx, id)
  const valid = knownSongs(ctx, songIds)
  const none = noSongsProblem(valid.length)
  if (none) throw refused(none)
  const changes: Change[] = valid.map(([, songUid]) => ({
    type: 'playlistSong' as const,
    hlc: ctx.stamp(),
    uid: found.uid,
    songUid,
    on: true,
  }))
  if (position !== undefined) {
    const current = ctx.view.playlistSongs[id] ?? []
    const order = insertedAt(
      current,
      valid.map(([songId]) => songId),
      position,
    )
    changes.push({
      type: 'playlistOrdered',
      hlc: ctx.stamp(),
      uid: found.uid,
      songUids: order.map(songId => songUid(ctx, songId)),
    })
  }
  return changes
}

export function removeFromPlaylist(
  ctx: EditContext,
  id: number,
  songIds: readonly number[],
): Change[] {
  const found = manual(ctx, id)
  return knownSongs(ctx, songIds).map(([, songUid]) => ({
    type: 'playlistSong' as const,
    hlc: ctx.stamp(),
    uid: found.uid,
    songUid,
    on: false,
  }))
}

// --- Importing -------------------------------------------------------------------

/**
 * A link for the server to import — this device cannot download it — with the
 * tags and the manual playlist to put what it brings in.
 */
export function requestImport(
  ctx: EditContext,
  input: { url: string; tagIds: readonly number[]; playlistId: number | null },
): { changes: Change[]; uid: string } {
  const playlistUid = input.playlistId === null ? null : manual(ctx, input.playlistId).uid
  const uid = make(ctx)
  return {
    changes: [
      {
        type: 'importRequested',
        hlc: ctx.stamp(),
        uid,
        url: input.url,
        tagUids: input.tagIds.flatMap(id => {
          const tag = ctx.view.uids.tags.get(id)
          return tag ? [tag] : []
        }),
        playlistUid,
      },
    ],
    uid,
  }
}

/** Called off, while it is still waiting for the server or downloading there. */
export function cancelImport(ctx: EditContext, uid: string): Change[] {
  const request = ctx.view.imports.find(item => item.uid === uid)
  if (!request) throw notFound('import')
  if (request.state !== 'waiting' && request.state !== 'working') {
    throw new CloudRouteError(409, 'that import has finished already', 'conflict')
  }
  return [{ type: 'importCancelled', hlc: ctx.stamp(), uid }]
}

/**
 * A playlist's order, its own or one that follows tags.
 *
 * A live playlist takes a hand order too — the server keeps it and lays it
 * over the rule's answer, and this is the same edit travelling through the
 * bucket, so a phone is let through just as the web, which reaches a server
 * directly, is.
 */
export function reorderPlaylist(
  ctx: EditContext,
  id: number,
  songIds: readonly number[],
): Change[] {
  const found = playlist(ctx, id)
  return [
    {
      type: 'playlistOrdered',
      hlc: ctx.stamp(),
      uid: found.uid,
      songUids: songIds.flatMap(songId => {
        const uid = ctx.view.uids.songs.get(songId)
        return uid ? [uid] : []
      }),
    },
  ]
}
