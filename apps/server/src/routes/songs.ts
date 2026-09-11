import { Router } from 'express'
import { z } from 'zod'
import {
  BooleanQuerySchema,
  BulkDeleteSongsSchema,
  BulkLovedSchema,
  IdSchema,
  PlayEventSchema,
  SetSongTagsSchema,
  SkipEventSchema,
  SongPatchSchema,
  type BulkDeleteFailure,
  type BulkDeleteResult,
  type LyricsResponse,
  type PlayRecorded,
  type SimilarSongs,
  type Song,
} from '@selfmp3/shared'
import type { Container } from '../container.js'
import { route } from '../http/route.js'
import { HttpError } from '../http/errors.js'
import { transact } from '../db/index.js'
import { sqliteTime } from '../repositories/stats.js'
import { similarSongs } from '../services/similar.js'
import { isLocalRequest, revealInFileManager } from '../services/reveal.js'
import { removeFolderIfEmpty } from '../services/libraryLayout.js'

const ParamsWithId = z.object({ id: IdSchema })

export function songRoutes(container: Container): Router {
  const router = Router()

  /** Look up a song or fail with a proper 404 rather than an undefined later. */
  const requireSong = (id: number) => {
    const song = container.songs.byId(id)
    if (!song) throw HttpError.notFound(`no song with id ${id}`)
    return song
  }

  /**
   * The 404 for a song with no words, remembering that about it first. It has
   * its own code so a client can say "instrumental" instead of "no lyrics
   * found", and the flag is what keeps the next play off the network.
   */
  const instrumental = (song: Song): HttpError => {
    if (!song.instrumental) {
      container.songs.setInstrumental(song.id, true)
      container.bumpLibraryVersion()
    }
    return new HttpError(404, 'this track is instrumental', 'instrumental')
  }

  /*
   * The bulk routes come first on purpose. `/songs/bulk/loved` would otherwise
   * be matched by `/songs/:id/loved` with an id of "bulk", which parses to a
   * 400 rather than to the handler anybody meant.
   */

  /**
   * Remove many songs from the library at once — the multi-select path.
   *
   * `deleteFile` carries the same weight it does on the single-song route:
   * off by default, and a separate decision from removing the row. The batch
   * is deliberately forgiving about the file system and strict about the
   * database: a file that is already gone is reported and skipped, while the
   * rows go in one transaction and the library version is bumped once.
   */
  router.post(
    '/songs/bulk/delete',
    route({ body: BulkDeleteSongsSchema }, async ({ body }): Promise<BulkDeleteResult> => {
      const requested = [...new Set(body.songIds)]
      const songs = container.songs.byIds(requested)
      const found = new Set(songs.map(song => song.id))
      const failed: BulkDeleteFailure[] = requested
        .filter(id => !found.has(id))
        .map(id => ({ songId: id, reason: `no song with id ${id}`, removed: false }))

      // Side effects one song at a time, and never fatal: the point of a batch
      // is that one bad file does not cost you the other thirty-nine.
      let filesDeleted = 0
      for (const song of songs) {
        if (body.deleteFile) {
          try {
            if (await container.storage.exists(song.path)) {
              await container.storage.delete(song.path)
              filesDeleted++
            } else {
              failed.push({
                songId: song.id,
                reason: 'the file was already missing from disk',
                removed: true,
              })
            }
            await container.lyrics.deleteSidecar(song.path)
            await removeFolderIfEmpty(container.storage, song.path)
          } catch (error) {
            failed.push({
              songId: song.id,
              reason: error instanceof Error ? error.message : 'could not delete the file',
              removed: true,
            })
          }
        }
        await container.covers.delete(song.id)
        await container.lyricsCache.delete(song.id)
        container.lyricsIndex.remove(song.id)
      }

      const { removed } = container.songs.deleteMany(songs.map(song => song.id))
      if (removed.length > 0) container.bumpLibraryVersion()

      return { removed: removed.length, filesDeleted, failed }
    }),
  )

  /** Love or unlove a whole selection in one request. */
  router.post(
    '/songs/bulk/loved',
    route({ body: BulkLovedSchema }, ({ body }) => {
      const affected = container.songs.setLovedMany(body.songIds, body.loved)
      if (affected > 0) container.bumpLibraryVersion()
      return { affected }
    }),
  )

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
    route({ params: ParamsWithId, body: PlayEventSchema }, ({ params, body }): PlayRecorded => {
      requireSong(params.id)
      // A play sent late carries when it happened; one sent twice carries the
      // same client id both times, and the second changes nothing.
      const playedAt = sqliteTime(body.playedAt)
      const recorded = transact(container.db, () => {
        const inserted = container.stats.record(
          params.id,
          body.msPlayed,
          body.completed,
          playedAt,
          body.clientId ?? null,
        )
        if (inserted) container.songs.recordPlay(params.id, playedAt)
        return inserted
      })
      return { ok: true as const, duplicate: !recorded }
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

  /**
   * Show the song's file in Finder, on the computer running self.mp3.
   *
   * Refused for anything but the browser on that computer — see
   * `isLocalRequest` for why loopback alone is not enough.
   */
  router.post(
    '/songs/:id/reveal',
    route({ params: ParamsWithId }, async ({ params, req }) => {
      const song = requireSong(params.id)
      if (!isLocalRequest(req)) {
        throw HttpError.forbidden('Show in Finder only works on the computer that runs self.mp3')
      }
      const absolute = container.storage.localPath(song.path)
      if (!absolute) {
        throw HttpError.conflict('your library is in cloud storage, so there is no folder to show')
      }
      if (song.missing || !(await container.storage.exists(song.path))) {
        throw HttpError.notFound('the file is missing from your library folder')
      }
      await revealInFileManager(absolute)
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
   * when the cached copy is wrong or badly timed. It is also how a song marked
   * instrumental gets looked up again: without it, such a song never is.
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
        const lookup = {
          artist: song.artist,
          title: song.title,
          album: song.album,
          duration: song.duration,
        }

        if (query.refresh) {
          const remote = await container.lyrics.fetchRemote(lookup)
          if (remote === 'instrumental') throw instrumental(song)
          if (!remote) throw HttpError.notFound('no lyrics found for this track')
          await container.lyrics.writeSidecar(song.path, remote.text, remote.synced)
          container.songs.setLyricsKind(params.id, remote.synced ? 'synced' : 'plain')
          container.songs.setInstrumental(params.id, false)
          container.bumpLibraryVersion()
          container.lyricsIndex.index(song.id, remote.text)
          return { source: 'remote', kind: remote.synced ? 'synced' : 'plain', text: remote.text }
        }

        // Local lyrics win even over the instrumental flag, but a song known to
        // have no words is not asked about again on every play.
        const metadata = await container.metadata.read(song.path)
        const resolved = await container.lyrics.resolve(
          song.path,
          metadata.embeddedLyrics,
          song.instrumental ? null : lookup,
        )

        if (resolved === 'instrumental') throw instrumental(song)
        if (!resolved) {
          if (song.instrumental) throw instrumental(song)
          throw HttpError.notFound('no lyrics for this track')
        }

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

  /**
   * Save hand-edited or hand-timed lyrics as a sidecar.
   *
   * Words written by hand mean the song is not instrumental after all, so the
   * flag is cleared. Clearing the lyrics leaves it alone.
   */
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
        container.songs.setInstrumental(params.id, false)
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
          await removeFolderIfEmpty(container.storage, song.path)
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
