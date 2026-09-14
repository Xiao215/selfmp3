import {
  hueFromString,
  newUid,
  sameTagName,
  toCloudRules,
  type Change,
  type CreatePlaylist,
  type Playlist,
  type PlayEvent,
  type Song,
  type SongPatch,
  type UpdatePlaylist,
} from '@selfmp3/shared'
import { CloudRouteError, notFound } from './errors.js'
import type { CloudLibrary } from './snapshotLibrary.js'

/**
 * Edits made on this device, as the changes that go in its log (docs/SYNC.md).
 *
 * Each takes the library as this device shows it, by the ids the app uses,
 * and says what changed, by uid. The replica applies them here at once and
 * uploads them; every other device replays them. Pure — the clock, new uids
 * and the time are handed in — and as strict as the server's routes, so an edit
 * the server would refuse is refused here too, before it is recorded.
 */
export interface EditContext {
  readonly view: CloudLibrary
  /** A stamp for each change, from this device's clock. */
  readonly stamp: () => string
  readonly newUid?: () => string
  readonly now?: () => Date
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

export function song(ctx: EditContext, id: number): Song {
  const found = ctx.view.library.songs.find(each => each.id === id)
  if (!found) throw notFound('song')
  return found
}

export function playlist(ctx: EditContext, id: number): Playlist & { uid: string } {
  const found = ctx.view.library.playlists.find(each => each.id === id)
  const uid = ctx.view.uids.playlists.get(id)
  if (!found || !uid) throw notFound('playlist')
  return { ...found, uid }
}

function manual(ctx: EditContext, id: number, refusal: string): Playlist & { uid: string } {
  const found = playlist(ctx, id)
  if (found.kind === 'live') throw new CloudRouteError(400, refusal, 'bad_request')
  return found
}

// --- Songs -----------------------------------------------------------------------

export function editSong(ctx: EditContext, id: number, patch: SongPatch): Change[] {
  return [{ type: 'songEdited', hlc: ctx.stamp(), uid: songUid(ctx, id), fields: patch }]
}

/** Loved or not, for every song asked about that is still here. */
export function loveSongs(ctx: EditContext, ids: readonly number[], loved: boolean): Change[] {
  return [...new Set(ids)].flatMap(id => {
    const uid = ctx.view.uids.songs.get(id)
    return uid ? [{ type: 'songEdited' as const, hlc: ctx.stamp(), uid, fields: { loved } }] : []
  })
}

/** A song's tags, all at once: the ones that go on, and the ones that come off. */
export function setSongTags(ctx: EditContext, id: number, tagIds: readonly number[]): Change[] {
  const current = song(ctx, id)
  const uid = songUid(ctx, id)
  // Tags that are gone are dropped quietly, as the server does for a stale phone.
  const wanted = new Set(tagIds.filter(tagId => ctx.view.uids.tags.has(tagId)))
  const had = new Set(current.tagIds)
  const flips = [
    ...[...wanted].filter(tagId => !had.has(tagId)).map(tagId => ({ tagId, on: true })),
    ...current.tagIds.filter(tagId => !wanted.has(tagId)).map(tagId => ({ tagId, on: false })),
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
  return [...new Set(songIds)].flatMap(id => {
    const uid = ctx.view.uids.songs.get(id)
    return uid ? [{ type: 'songTagged' as const, hlc: ctx.stamp(), uid, tagUid: tag, on }] : []
  })
}

/**
 * Out of the library, on every device.
 *
 * `deleteFile` is what the person was asked and answered, carried through so
 * the server does the same thing it would have done had they asked it directly.
 */
export function removeSongs(
  ctx: EditContext,
  ids: readonly number[],
  deleteFile = false,
): Change[] {
  return [...new Set(ids)].flatMap(id => {
    const uid = ctx.view.uids.songs.get(id)
    return uid ? [{ type: 'songRemoved' as const, hlc: ctx.stamp(), uid, deleteFile }] : []
  })
}

export function playSong(ctx: EditContext, id: number, event: PlayEvent): Change[] {
  return [
    {
      type: 'songPlayed',
      hlc: ctx.stamp(),
      uid: songUid(ctx, id),
      // The play outbox's own id, so a play sent twice still counts once.
      playId: event.clientId ?? make(ctx),
      playedAt: event.playedAt ?? nowOf(ctx).toISOString(),
      msPlayed: event.msPlayed,
      completed: event.completed,
    },
  ]
}

export function skipSong(ctx: EditContext, id: number, atSeconds: number): Change[] {
  return [
    {
      type: 'songSkipped',
      hlc: ctx.stamp(),
      uid: songUid(ctx, id),
      skipId: make(ctx),
      skippedAt: nowOf(ctx).toISOString(),
      atSeconds,
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
  const existing = ctx.view.library.tags.find(tag => sameTagName(tag.name, name))
  if (existing) return { changes: [], uid: tagUid(ctx, existing.id) }
  const uid = make(ctx)
  return {
    changes: [
      {
        type: 'tagCreated',
        hlc: ctx.stamp(),
        uid,
        name,
        hue: hue ?? hueFromString(name.toLowerCase()),
      },
    ],
    uid,
  }
}

export function editTag(
  ctx: EditContext,
  id: number,
  fields: { name?: string | undefined; hue?: number | undefined },
): Change[] {
  const uid = tagUid(ctx, id)
  if (fields.name !== undefined) {
    const name = fields.name
    const clash = ctx.view.library.tags.find(tag => tag.id !== id && sameTagName(tag.name, name))
    if (clash) throw new CloudRouteError(409, `a tag called "${name}" already exists`, 'conflict')
  }
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

// --- Playlists -------------------------------------------------------------------

const cloudRules = (ctx: EditContext, rules: NonNullable<CreatePlaylist['rules']>) =>
  toCloudRules(rules, id => ctx.view.uids.tags.get(id) ?? null)

export function createPlaylist(
  ctx: EditContext,
  input: CreatePlaylist,
): { changes: Change[]; uid: string } {
  if (input.kind === 'live' && !input.rules) {
    throw new CloudRouteError(400, 'a live playlist needs a rule set', 'bad_request')
  }
  const uid = make(ctx)
  return {
    changes: [
      {
        type: 'playlistCreated',
        hlc: ctx.stamp(),
        uid,
        kind: input.kind,
        name: input.name,
        description: input.description,
        rules: input.kind === 'live' && input.rules ? cloudRules(ctx, input.rules) : null,
        pinned: false,
      },
    ],
    uid,
  }
}

export function editPlaylist(ctx: EditContext, id: number, patch: UpdatePlaylist): Change[] {
  const found = playlist(ctx, id)
  if (patch.rules !== undefined && found.kind === 'manual' && patch.rules !== null) {
    throw new CloudRouteError(400, 'a manual playlist cannot have rules', 'bad_request')
  }
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
  const found = manual(ctx, id, 'a live playlist builds itself — edit its rules instead')
  const valid = [...new Set(songIds)].filter(songId => ctx.view.uids.songs.has(songId))
  if (valid.length === 0) {
    throw new CloudRouteError(400, 'none of those songs exist', 'bad_request')
  }
  const changes: Change[] = valid.map(songId => ({
    type: 'playlistSong' as const,
    hlc: ctx.stamp(),
    uid: found.uid,
    songUid: songUid(ctx, songId),
    on: true,
  }))
  if (position !== undefined) {
    const current = ctx.view.playlistSongs[id] ?? []
    const incoming = valid.filter(songId => !current.includes(songId))
    const at = Math.min(Math.max(position, 0), current.length)
    const order = [...current.slice(0, at), ...incoming, ...current.slice(at)]
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
  const found = manual(ctx, id, 'a live playlist builds itself — edit its rules instead')
  return [...new Set(songIds)].flatMap(songId => {
    const uid = ctx.view.uids.songs.get(songId)
    return uid
      ? [
          {
            type: 'playlistSong' as const,
            hlc: ctx.stamp(),
            uid: found.uid,
            songUid: uid,
            on: false,
          },
        ]
      : []
  })
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
  const playlistUid =
    input.playlistId === null
      ? null
      : manual(ctx, input.playlistId, 'imported songs go into a manual playlist').uid
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

export function reorderPlaylist(
  ctx: EditContext,
  id: number,
  songIds: readonly number[],
): Change[] {
  const found = manual(ctx, id, 'a live playlist is ordered by its rules')
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
