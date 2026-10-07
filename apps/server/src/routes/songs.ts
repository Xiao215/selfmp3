import { Router } from 'express'
import { z } from 'zod'
import {
  BulkDeleteSongsSchema,
  BulkEditSongsSchema,
  BulkLovedSchema,
  MOTION_VERSION,
  PlayEventSchema,
  SONG_FIELDS,
  SetSongTagsSchema,
  SimilarQuerySchema,
  similarSongs,
  SkipEventSchema,
  SongPatchSchema,
  type Affected,
  type BulkDeleteResult,
  type LyricsResponse,
  type PlayRecorded,
  type SimilarSongs,
  type Song,
  type SongFields,
} from '@selfmp3/shared'
import type { Container } from '../container.js'
import { route } from '../http/route.js'
import { HttpError } from '../http/errors.js'
import { ParamsWithId, requireSong } from '../http/params.js'
import { transact } from '../db/index.js'
import { sqliteTime } from '../repositories/stats.js'
import { romanizedLines } from '../services/romanizedLines.js'

/** The fields a patch sets, in `SONG_FIELDS` order: what an edit to it is stamped with. */
const fieldsOf = (patch: Partial<SongFields>): (keyof SongFields)[] =>
  SONG_FIELDS.filter(field => patch[field] !== undefined)

export function songRoutes(container: Container): Router {
  const router = Router()
  const songOrThrow = (id: number): Song => requireSong(container.songs, id)

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
   * The batch is deliberately forgiving about the file system and strict
   * about the database: a copy that will not go is reported, while the rows go
   * in one transaction and the library version is bumped once.
   */
  router.post(
    '/songs/bulk/delete',
    route({ body: BulkDeleteSongsSchema }, async ({ body }): Promise<BulkDeleteResult> => {
      const { removed, failed } = await container.songRemoval.remove(body.songIds)
      return { removed: removed.length, failed }
    }),
  )

  /** Love or unlove a whole selection in one request. */
  router.post(
    '/songs/bulk/loved',
    route({ body: BulkLovedSchema }, ({ body }): Affected => {
      const affected = container.songs.setLovedMany(body.songIds, body.loved)
      container.edits.songs(body.songIds, ['loved'])
      if (affected > 0) container.bumpLibraryVersion()
      return { affected }
    }),
  )

  /**
   * Many songs' edits in one transaction: Tidy up's approved changes, up to a
   * couple of thousand at once. Which songs still exist is asked once, and the
   * edits are stamped a field list at a time — one approval is one edit — so
   * the request is a handful of statements rather than several per song.
   */
  router.post(
    '/songs/bulk/edit',
    route({ body: BulkEditSongsSchema }, ({ body }): Affected => {
      const present = container.songs.existingIds(body.edits.map(edit => edit.songId))
      const here = body.edits.filter(edit => present.has(edit.songId))
      const byFields = new Map<string, { fields: (keyof SongFields)[]; ids: number[] }>()
      for (const { songId, patch } of here) {
        const fields = fieldsOf(patch)
        const key = fields.join(',')
        const group = byFields.get(key) ?? { fields, ids: [] }
        group.ids.push(songId)
        byFields.set(key, group)
      }
      transact(container.db, () => {
        for (const { songId, patch } of here) container.songs.patch(songId, patch)
        for (const { fields, ids } of byFields.values()) container.edits.songs(ids, fields)
      })
      if (here.length > 0) container.bumpLibraryVersion()
      return { affected: here.length }
    }),
  )

  router.patch(
    '/songs/:id',
    route({ params: ParamsWithId, body: SongPatchSchema }, ({ params, body }) => {
      songOrThrow(params.id)
      container.songs.patch(params.id, body)
      container.edits.songs([params.id], fieldsOf(body))
      container.bumpLibraryVersion()
      return container.songs.byId(params.id)
    }),
  )

  router.put(
    '/songs/:id/tags',
    route({ params: ParamsWithId, body: SetSongTagsSchema }, ({ params, body }) => {
      const song = songOrThrow(params.id)
      // Silently drop ids for tags that no longer exist rather than 400ing —
      // a phone working from a stale library should not hit an error wall.
      const valid = container.tags.exists(body.tagIds)
      transact(container.db, () => container.tags.setSongTags(params.id, valid))
      // Stamped: the tags that went on, and the ones that came off.
      const before = new Set(song.tagIds)
      const after = new Set(valid)
      container.edits.songTags(params.id, [
        ...valid.filter(id => !before.has(id)),
        ...song.tagIds.filter(id => !after.has(id)),
      ])
      container.bumpLibraryVersion()
      return container.songs.byId(params.id)
    }),
  )

  router.post(
    '/songs/:id/loved',
    route({ params: ParamsWithId, body: z.object({ loved: z.boolean() }) }, ({ params, body }) => {
      songOrThrow(params.id)
      container.songs.patch(params.id, { loved: body.loved })
      container.edits.songs([params.id], ['loved'])
      container.bumpLibraryVersion()
      return container.songs.byId(params.id)
    }),
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
      songOrThrow(params.id)
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
      return { ok: true, duplicate: !recorded }
    }),
  )

  /**
   * A skip. Sent twice, counted once — the same bargain a play gets.
   *
   * The outbox keeps a skip whose response was lost and sends it again, so
   * without the id a flaky connection quietly inflates the count that feeds
   * forgotten gems, Wrapped and any smart rule built on it. `counted_skips` is
   * the same table the cloud path dedupes against, so the two agree.
   */
  router.post(
    '/songs/:id/skipped',
    route({ params: ParamsWithId, body: SkipEventSchema }, ({ params, body }): PlayRecorded => {
      songOrThrow(params.id)
      const counted = transact(container.db, () => {
        if (body.clientId !== undefined && !container.syncRepo.countSkip(body.clientId))
          return false
        container.songs.recordSkip(params.id)
        return true
      })
      return { ok: true, duplicate: !counted }
    }),
  )

  /**
   * The songs that sound most like this one, as the listening model heard them
   * (sound/sound.ts), nudged by shared tags and the artist. A song not heard
   * yet falls back to tempo, key, energy and loudness, and so do the songs
   * that fill the list past the ones heard.
   */
  router.get(
    '/songs/:id/similar',
    route(
      {
        params: ParamsWithId,
        query: SimilarQuerySchema,
      },
      ({ params, query }): SimilarSongs => {
        const seed = songOrThrow(params.id)
        const library = container.songs.all()
        const byFeatures = similarSongs(seed, library, query.limit)
        return {
          songId: seed.id,
          songs: container.sound.similar(seed, library, query.limit, byFeatures) ?? byFeatures,
        }
      },
    ),
  )

  /**
   * Lyrics, resolved through sidecar -> embedded tag -> lrclib.
   *
   * Local lyrics win even over the instrumental flag, but a song known to have
   * no words is not asked about again on every play.
   */
  router.get(
    '/songs/:id/lyrics',
    route({ params: ParamsWithId }, async ({ params }): Promise<LyricsResponse> => {
      const song = songOrThrow(params.id)
      const metadata = await container.metadata.read(song.path)
      const resolved = await container.lyrics.resolve(
        song.id,
        song.path,
        metadata.embeddedLyrics,
        song.instrumental
          ? null
          : {
              artist: song.artist,
              title: song.title,
              album: song.album,
              duration: song.duration,
              sourceUrl: song.sourceUrl,
            },
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
      // The romaji rides with the words: made once per text, kept with them.
      return { ...resolved, romanized: await romanizedLines(container, song.id, resolved.text) }
    }),
  )

  /**
   * The song's motion curve (packages/shared/src/schemas/motion.ts): how loud it is and where the
   * hits are, twenty times a second, made when the song was analysed.
   *
   * A 404 coded `not-analysed` until analysis has run — including for a song
   * whose file changed since, because the features row goes with the old file
   * and a curve is only answered beside one. The file changes only when the
   * song is analysed again, so a client may keep it for an hour and then ask
   * again with the ETag.
   */
  router.get(
    '/songs/:id/motion',
    route({ params: ParamsWithId }, async ({ params, res }) => {
      songOrThrow(params.id)
      const stored = container.audioFeatures.bySong(params.id)
        ? await container.motion.read(params.id)
        : null
      if (!stored) throw new HttpError(404, 'this song has not been analysed yet', 'not-analysed')

      res.setHeader('Cache-Control', 'private, max-age=3600')
      // Which algorithm, and when analysis wrote it: a re-analysis is a new tag.
      res.setHeader(
        'ETag',
        `"motion-${MOTION_VERSION}-${Math.round(stored.mtimeMs).toString(36)}-${stored.size}"`,
      )
      // Sent as written; `send` answers a matching If-None-Match with a 304.
      res.type('application/json').send(stored.json)
      return undefined
    }),
  )

  return router
}
