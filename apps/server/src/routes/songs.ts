import { Router } from 'express'
import { z } from 'zod'
import {
  BooleanQuerySchema,
  IdSchema,
  PlayEventSchema,
  SetSongTagsSchema,
  SkipEventSchema,
  SongPatchSchema,
  type LyricsResponse,
  type SimilarSongs,
} from '@selfmp3/shared'
import type { Container } from '../container.js'
import { route } from '../http/route.js'
import { HttpError } from '../http/errors.js'
import { transact } from '../db/index.js'
import { similarSongs } from '../services/similar.js'

const ParamsWithId = z.object({ id: IdSchema })

export function songRoutes(container: Container): Router {
  const router = Router()

  /** Look up a song or fail with a proper 404 rather than an undefined later. */
  const requireSong = (id: number) => {
    const song = container.songs.byId(id)
    if (!song) throw HttpError.notFound(`no song with id ${id}`)
    return song
  }

  router.get(
    '/songs/:id',
    route({ params: ParamsWithId }, ({ params }) => requireSong(params.id)),
  )

  router.patch(
    '/songs/:id',
    route({ params: ParamsWithId, body: SongPatchSchema }, ({ params, body }) => {
      requireSong(params.id)
      container.songs.patch(params.id, body)
      container.bumpLibraryVersion()
      return container.songs.byId(params.id)
    }),
  )

  router.put(
    '/songs/:id/tags',
    route({ params: ParamsWithId, body: SetSongTagsSchema }, ({ params, body }) => {
      requireSong(params.id)
      // Silently drop ids for tags that no longer exist rather than 400ing —
      // a phone working from a stale library should not hit an error wall.
      const valid = container.tags.exists(body.tagIds)
      transact(container.db, () => container.tags.setSongTags(params.id, valid))
      container.bumpLibraryVersion()
      return container.songs.byId(params.id)
    }),
  )

  router.post(
    '/songs/:id/loved',
    route(
      { params: ParamsWithId, body: z.object({ loved: z.boolean() }) },
      ({ params, body }) => {
        requireSong(params.id)
        container.songs.patch(params.id, { loved: body.loved })
        container.bumpLibraryVersion()
        return container.songs.byId(params.id)
      },
    ),
  )

  /**
   * Record a play.
   *
   * The client decides when a play "counts" — it is the only party that knows
   * about seeking, pausing and tab switches — and the server records both the
   * event (for history and stats) and the running counter (for smart playlists
   * and sorting).
   */
  router.post(
    '/songs/:id/played',
    route({ params: ParamsWithId, body: PlayEventSchema }, ({ params, body }) => {
      requireSong(params.id)
      transact(container.db, () => {
        container.stats.record(params.id, body.msPlayed, body.completed)
        container.songs.recordPlay(params.id)
      })
      return { ok: true as const }
    }),
  )

  router.post(
    '/songs/:id/skipped',
    route({ params: ParamsWithId, body: SkipEventSchema }, ({ params }) => {
      requireSong(params.id)
      container.songs.recordSkip(params.id)
      return { ok: true as const }
    }),
  )

  /** Nearest neighbours by tempo, key, energy, loudness, tags and artist. */
  router.get(
    '/songs/:id/similar',
    route(
      {
        params: ParamsWithId,
        query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }),
      },
      ({ params, query }): SimilarSongs => {
        const seed = requireSong(params.id)
        return {
          songId: seed.id,
          songs: similarSongs(seed, container.songs.all(), query.limit),
        }
      },
    ),
  )

  /**
   * Lyrics, resolved through sidecar -> embedded tag -> lrclib.
   *
   * `refresh=1` skips the local sources and goes straight to the network, for
   * when the cached copy is wrong or badly timed.
   */
  router.get(
    '/songs/:id/lyrics',
    route(
      {
        params: ParamsWithId,
        query: z.object({ refresh: BooleanQuerySchema }),
      },
      async ({ params, query }): Promise<LyricsResponse> => {
        const song = requireSong(params.id)

        if (query.refresh) {
          const remote = await container.lyrics.fetchRemote({
            artist: song.artist,
            title: song.title,
            album: song.album,
            duration: song.duration,
          })
          if (!remote) throw HttpError.notFound('no lyrics found for this track')
          await container.lyrics.writeSidecar(song.path, remote.text, remote.synced)
          container.songs.setLyricsKind(params.id, remote.synced ? 'synced' : 'plain')
          container.bumpLibraryVersion()
          container.lyricsIndex.index(song.id, remote.text)
          return { source: 'remote', kind: remote.synced ? 'synced' : 'plain', text: remote.text }
        }

        const metadata = await container.metadata.read(song.path)
        const resolved = await container.lyrics.resolve(song.path, metadata.embeddedLyrics, {
          artist: song.artist,
          title: song.title,
          album: song.album,
          duration: song.duration,
        })

        if (!resolved) throw HttpError.notFound('no lyrics for this track')

        // Keep the stored flag honest so smart playlists and the offline
        // mirror agree with what is actually on disk.
        if (song.lyricsKind !== resolved.kind) {
          container.songs.setLyricsKind(params.id, resolved.kind)
          container.bumpLibraryVersion()
        }

        container.lyricsIndex.index(song.id, resolved.text)
        return resolved
      },
    ),
  )

  /** Save hand-edited or hand-timed lyrics as a sidecar. */
  router.put(
    '/songs/:id/lyrics',
    route(
      {
        params: ParamsWithId,
        body: z.object({ text: z.string().max(100_000) }),
      },
      async ({ params, body }) => {
        const song = requireSong(params.id)
        const trimmed = body.text.trim()

        if (!trimmed) {
          await container.lyrics.deleteSidecar(song.path)
          container.songs.setLyricsKind(params.id, 'none')
          container.bumpLibraryVersion()
          container.lyricsIndex.remove(song.id)
          await container.lyricsCache.delete(song.id)
          return { ok: true as const, kind: 'none' as const }
        }

        const synced = /\[\d{1,3}:\d{1,2}/.test(trimmed)
        // Remove the other sidecar format first so a .txt and .lrc for the
        // same song cannot disagree.
        await container.lyrics.deleteSidecar(song.path)
        await container.lyrics.writeSidecar(song.path, body.text, synced)
        container.songs.setLyricsKind(params.id, synced ? 'synced' : 'plain')
        container.bumpLibraryVersion()
        container.lyricsIndex.index(song.id, body.text)
        return { ok: true as const, kind: synced ? ('synced' as const) : ('plain' as const) }
      },
    ),
  )

  /**
   * Remove a song from the library.
   *
   * `deleteFile=1` also removes the audio from disk. Defaults to off, because
   * "remove from my list" and "destroy the file" should never be the same
   * button by accident.
   */
  router.delete(
    '/songs/:id',
    route(
      {
        params: ParamsWithId,
        query: z.object({ deleteFile: BooleanQuerySchema }),
      },
      async ({ params, query }) => {
        const song = requireSong(params.id)

        if (query.deleteFile) {
          await container.storage.delete(song.path).catch(() => undefined)
          await container.lyrics.deleteSidecar(song.path)
        }

        await container.covers.delete(song.id)
        await container.lyricsCache.delete(song.id)
        container.songs.delete(song.id)
        container.bumpLibraryVersion()
        return { ok: true as const, fileDeleted: query.deleteFile }
      },
    ),
  )

  return router
}
