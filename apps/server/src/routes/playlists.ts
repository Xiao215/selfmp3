import { Router } from 'express'
import { z } from 'zod'
import {
  AddToPlaylistSchema,
  CreatePlaylistSchema,
  describeSmartRules,
  IdSchema,
  RemoveFromPlaylistSchema,
  ReorderPlaylistSchema,
  UpdatePlaylistSchema,
} from '@selfmp3/shared'
import type { Container } from '../container.js'
import { route } from '../http/route.js'
import { HttpError } from '../http/errors.js'

const ParamsWithId = z.object({ id: IdSchema })
const ParamsWithSong = z.object({ id: IdSchema, songId: IdSchema })

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
      if (body.kind === 'live' && !body.rules) {
        throw HttpError.badRequest('a live playlist needs a rule set')
      }
      const created = container.playlists.create(body)
      container.bumpLibraryVersion()
      return created
    }),
  )

  router.get(
    '/playlists/:id',
    route({ params: ParamsWithId }, ({ params }) => requirePlaylist(params.id)),
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
      const playlist = requirePlaylist(params.id)
      if (body.rules !== undefined && playlist.kind === 'manual' && body.rules !== null) {
        throw HttpError.badRequest('a manual playlist cannot have rules')
      }
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
      container.playlists.stopFollowing(playlist)
      container.edits.playlist(params.id, ['rules', 'order'])
      container.bumpLibraryVersion()
      return container.playlists.byId(params.id) ?? playlist
    }),
  )

  router.delete(
    '/playlists/:id',
    route({ params: ParamsWithId }, ({ params }) => {
      requirePlaylist(params.id)
      container.playlists.delete(params.id)
      container.bumpLibraryVersion()
      return { ok: true as const }
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
    route({ params: ParamsWithId }, ({ params }) => {
      requirePlaylist(params.id)
      container.playlists.markPlayed(params.id)
      return { ok: true as const }
    }),
  )

  router.post(
    '/playlists/:id/songs',
    route({ params: ParamsWithId, body: AddToPlaylistSchema }, ({ params, body }) => {
      const playlist = requirePlaylist(params.id)
      if (playlist.kind === 'live') {
        throw HttpError.badRequest('a live playlist builds itself — edit its rules instead')
      }

      // Drop ids that are not real songs rather than failing the whole request.
      const valid = body.songIds.filter(id => container.songs.byId(id) !== null)
      if (valid.length === 0) throw HttpError.badRequest('none of those songs exist')

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
    route({ params: ParamsWithId, body: RemoveFromPlaylistSchema }, ({ params, body }) => {
      const playlist = requirePlaylist(params.id)
      if (playlist.kind === 'live') {
        throw HttpError.badRequest('a live playlist builds itself — edit its rules instead')
      }
      const removed = container.playlists.removeMany(params.id, body.songIds)
      container.edits.playlistSongs(params.id, body.songIds)
      if (removed > 0) container.bumpLibraryVersion()
      return { removed, playlist: container.playlists.byId(params.id) }
    }),
  )

  router.delete(
    '/playlists/:id/songs/:songId',
    route({ params: ParamsWithSong }, ({ params }) => {
      const playlist = requirePlaylist(params.id)
      if (playlist.kind === 'live') {
        throw HttpError.badRequest('a live playlist builds itself — edit its rules instead')
      }
      container.playlists.remove(params.id, params.songId)
      container.edits.playlistSongs(params.id, [params.songId])
      container.bumpLibraryVersion()
      return container.playlists.byId(params.id)
    }),
  )

  router.put(
    '/playlists/:id/order',
    route({ params: ParamsWithId, body: ReorderPlaylistSchema }, ({ params, body }) => {
      // A playlist that follows tags takes a hand order too: it keeps finding
      // songs, and the ones it finds land after the order you set (Xiao,
      // 2026-09-21).
      requirePlaylist(params.id)
      container.playlists.reorder(params.id, body.songIds)
      container.edits.playlist(params.id, ['order'])
      container.bumpLibraryVersion()
      return { ok: true as const }
    }),
  )

  /**
   * Preview a rule set before saving it.
   *
   * Lets the rule builder show "matches 43 songs" as you type,
   * which is the difference between guessing at rules and understanding them.
   */
  router.post(
    '/playlists/preview',
    route(
      {
        body: z.object({
          rules: z.lazy(() => CreatePlaylistSchema.shape.rules),
        }),
      },
      ({ body }) => {
        if (!body.rules) return { songIds: [], description: 'No rules yet' }

        const tagNames = new Map(container.tags.all().map(tag => [tag.id, tag.name]))
        const songIds = container.playlists.songIds({
          id: 0,
          name: 'preview',
          description: '',
          kind: 'live',
          rules: body.rules,
          songCount: 0,
          totalDuration: 0,
          pinned: false,
          createdAt: '',
          updatedAt: '',
          lastPlayedAt: null,
        })

        return { songIds, description: describeSmartRules(body.rules, tagNames) }
      },
    ),
  )

  return router
}
