import { Router } from 'express'
import {
  AddToPlaylistSchema,
  CreatePlaylistSchema,
  RemoveFromPlaylistSchema,
  ReorderPlaylistSchema,
  UpdatePlaylistSchema,
  noSongsProblem,
  playlistPatchProblem,
  playlistSongsProblem,
  type Ok,
  type RemovedFromPlaylist,
} from '@selfmp3/shared'
import type { Container } from '../container.js'
import { route } from '../http/route.js'
import { HttpError } from '../http/errors.js'
import { ParamsWithId } from '../http/params.js'

export function playlistRoutes(container: Container): Router {
  const router = Router()

  const requirePlaylist = (id: number) => {
    const playlist = container.playlists.byId(id)
    if (!playlist) throw HttpError.notFound(`no playlist with id ${id}`)
    return playlist
  }

  router.get(
    '/playlists',
    route({}, () => container.playlists.all()),
  )

  router.post(
    '/playlists',
    route({ body: CreatePlaylistSchema }, ({ body }) => {
      // Its first songs in the same transaction: a playlist made with them, or
      // not made at all. Ids that are not real songs are dropped, as an add drops them.
      const songIds = body.kind === 'manual' ? (body.songIds ?? []) : []
      const present = container.songs.existingIds(songIds)
      const valid = songIds.filter(id => present.has(id))
      const created = container.playlists.create(body, valid)
      if (valid.length > 0) container.edits.playlistSongs(created.id, valid)
      container.bumpLibraryVersion()
      return container.playlists.byId(created.id) ?? created
    }),
  )

  /** Ordered song ids. Live playlists resolve their rules on every read. */
  router.get(
    '/playlists/:id/songs',
    route({ params: ParamsWithId }, ({ params }) => ({
      playlistId: params.id,
      songIds: container.playlists.songIds(requirePlaylist(params.id)),
    })),
  )

  router.patch(
    '/playlists/:id',
    route({ params: ParamsWithId, body: UpdatePlaylistSchema }, ({ params, body }) => {
      const problem = playlistPatchProblem(requirePlaylist(params.id).kind, body)
      if (problem) throw HttpError.refused(problem)
      const updated = container.playlists.update(params.id, body)
      container.edits.playlist(
        params.id,
        (['name', 'description', 'rules', 'pinned'] as const).filter(
          field => body[field] !== undefined,
        ),
      )
      container.bumpLibraryVersion()
      return updated
    }),
  )

  /**
   * Stop following tags, and keep the songs.
   *
   * Its own route rather than a field on PATCH, because it is not an edit to a
   * value — it resolves the rules, writes the answer down as the playlist's
   * songs, and changes the kind, and all three have to happen together. A PATCH
   * that could silently empty a playlist depending on the order fields were
   * applied in is the wrong shape for that.
   *
   * Doing it to a playlist that is not following anything is not an error: the
   * caller wanted a playlist that does not follow tags, and there it is.
   */
  router.post(
    '/playlists/:id/stop-following',
    route({ params: ParamsWithId }, ({ params }) => {
      const playlist = requirePlaylist(params.id)
      container.playlists.stopFollowing(playlist, container.playlists.songIds(playlist))
      container.edits.playlist(params.id, ['rules', 'order'])
      container.bumpLibraryVersion()
      return container.playlists.byId(params.id) ?? playlist
    }),
  )

  router.delete(
    '/playlists/:id',
    route({ params: ParamsWithId }, ({ params }): Ok => {
      requirePlaylist(params.id)
      container.playlists.delete(params.id)
      container.bumpLibraryVersion()
      return { ok: true }
    }),
  )

  /**
   * The playlist was started. No library version bump: this moves on every
   * play, and making every device refetch the library for it would cost more
   * than the order it feeds is worth. The device that played it updates its
   * own copy; others see the new order on their next library read.
   */
  router.post(
    '/playlists/:id/played',
    route({ params: ParamsWithId }, ({ params }): Ok => {
      requirePlaylist(params.id)
      container.playlists.markPlayed(params.id)
      return { ok: true }
    }),
  )

  router.post(
    '/playlists/:id/songs',
    route({ params: ParamsWithId, body: AddToPlaylistSchema }, ({ params, body }) => {
      const live = playlistSongsProblem(requirePlaylist(params.id).kind)
      if (live) throw HttpError.refused(live)

      // Drop ids that are not real songs rather than failing the whole request.
      const present = container.songs.existingIds(body.songIds)
      const valid = body.songIds.filter(id => present.has(id))
      const none = noSongsProblem(valid.length)
      if (none) throw HttpError.refused(none)

      if (body.position === undefined) container.playlists.add(params.id, valid)
      else container.playlists.add(params.id, valid, body.position)

      container.edits.playlistSongs(params.id, valid)
      // Put somewhere other than the end: the order is an edit too.
      if (body.position !== undefined) container.edits.playlist(params.id, ['order'])
      container.bumpLibraryVersion()
      return container.playlists.byId(params.id)
    }),
  )

  /**
   * Take a whole selection out of a manual playlist.
   *
   * A POST rather than a DELETE with a body: request bodies on DELETE are
   * legal but unevenly supported, and this is the path the multi-select bar
   * uses on a phone. Removing from a playlist never touches the songs.
   */
  router.post(
    '/playlists/:id/songs/remove',
    route(
      { params: ParamsWithId, body: RemoveFromPlaylistSchema },
      ({ params, body }): RemovedFromPlaylist => {
        const live = playlistSongsProblem(requirePlaylist(params.id).kind)
        if (live) throw HttpError.refused(live)
        const removed = container.playlists.removeMany(params.id, body.songIds)
        container.edits.playlistSongs(params.id, body.songIds)
        if (removed > 0) container.bumpLibraryVersion()
        return { removed, playlist: container.playlists.byId(params.id) }
      },
    ),
  )

  router.put(
    '/playlists/:id/order',
    route({ params: ParamsWithId, body: ReorderPlaylistSchema }, ({ params, body }): Ok => {
      // A playlist that follows tags takes a hand order too: the songs it
      // finds later land after the order you set (`PlaylistRepository.reorder`).
      requirePlaylist(params.id)
      container.playlists.reorder(params.id, body.songIds)
      container.edits.playlist(params.id, ['order'])
      container.bumpLibraryVersion()
      return { ok: true }
    }),
  )

  return router
}
