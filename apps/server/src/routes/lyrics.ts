import { Router } from 'express'
import { z } from 'zod'
import {
  IdSchema,
  type LyricsSearchResponse,
  type RomanizedLyrics,
  type Song,
} from '@selfmp3/shared'
import type { Container } from '../container.js'
import { route } from '../http/route.js'
import { HttpError } from '../http/errors.js'
import { LyricsCache } from '../services/lyricsCache.js'

const ParamsWithId = z.object({ id: IdSchema })

/**
 * Lyrics+: romanization and lyric search.
 *
 * The lyrics themselves are still served by `GET /songs/:id/lyrics`; these
 * endpoints derive from the same resolved text, so whatever that route would
 * show is what gets romanized and indexed.
 */
export function lyricsRoutes(container: Container): Router {
  const router = Router()

  const requireSong = (id: number): Song => {
    const song = container.songs.byId(id)
    if (!song) throw HttpError.notFound(`no song with id ${id}`)
    return song
  }

  /**
   * The same resolution as GET /songs/:id/lyrics, plus keeping the index warm.
   * That includes the instrumental flag: a song known to have no words stays
   * off the network, and lrclib saying so is remembered.
   */
  const resolveText = async (song: Song): Promise<string> => {
    const metadata = await container.metadata.read(song.path)
    const resolved = await container.lyrics.resolve(
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
    if (resolved === 'instrumental') {
      container.songs.setInstrumental(song.id, true)
      container.bumpLibraryVersion()
    }
    if (resolved === 'instrumental' || (!resolved && song.instrumental)) {
      throw new HttpError(404, 'this track is instrumental', 'instrumental')
    }
    if (!resolved) throw HttpError.notFound('no lyrics for this track')
    container.lyricsIndex.index(song.id, resolved.text)
    return resolved.text
  }

  router.get(
    '/songs/:id/lyrics/romanized',
    route({ params: ParamsWithId }, async ({ params }): Promise<RomanizedLyrics> => {
      const song = requireSong(params.id)
      const text = await resolveText(song)
      const hash = LyricsCache.hash(text)

      const cached = await container.lyricsCache.read<RomanizedLyrics>(song.id, 'romanized', hash)
      if (cached) return cached

      const result = await container.romanization.romanize(text)
      await container.lyricsCache.write(song.id, 'romanized', hash, result)
      return result
    }),
  )

  router.get(
    '/lyrics/search',
    route(
      {
        query: z.object({
          q: z.string().trim().max(200).default(''),
          limit: z.coerce.number().int().min(1).max(50).default(12),
        }),
      },
      ({ query }): LyricsSearchResponse => ({
        hits: query.q ? container.lyricsIndex.search(query.q, query.limit) : [],
      }),
    ),
  )

  return router
}
