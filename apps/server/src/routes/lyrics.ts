import { Router } from 'express'
import { z } from 'zod'
import {
  IdSchema,
  SetSecretSchema,
  TranslationLangSchema,
  type LyricsSearchResponse,
  type RomanizedLyrics,
  type SecretsStatus,
  type Song,
  type TranslatedLyrics,
} from '@selfmp3/shared'
import type { Container } from '../container.js'
import { route } from '../http/route.js'
import { HttpError } from '../http/errors.js'
import { LyricsCache } from '../services/lyricsCache.js'
import { TranslationError } from '../services/translation.js'

const ParamsWithId = z.object({ id: IdSchema })

/**
 * Lyrics+: romanization, translation, lyric search, and provider keys.
 *
 * The lyrics themselves are still served by `GET /songs/:id/lyrics`; these
 * endpoints derive from the same resolved text, so whatever that route would
 * show is what gets romanized, translated and indexed.
 */
export function lyricsRoutes(container: Container): Router {
  const router = Router()

  const requireSong = (id: number): Song => {
    const song = container.songs.byId(id)
    if (!song) throw HttpError.notFound(`no song with id ${id}`)
    return song
  }

  /** The same resolution as GET /songs/:id/lyrics, plus keeping the index warm. */
  const resolveText = async (song: Song): Promise<string> => {
    const metadata = await container.metadata.read(song.path)
    const resolved = await container.lyrics.resolve(song.path, metadata.embeddedLyrics, {
      artist: song.artist,
      title: song.title,
      album: song.album,
      duration: song.duration,
    })
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
    '/songs/:id/lyrics/translation',
    route(
      {
        params: ParamsWithId,
        query: z.object({ lang: TranslationLangSchema.optional() }),
      },
      async ({ params, query }): Promise<TranslatedLyrics> => {
        const song = requireSong(params.id)
        const settings = container.settings.get()
        const lang = (query.lang ?? settings.lyricsTranslationLang).toLowerCase()
        const provider = settings.lyricsTranslationProvider
        if (provider === 'none') {
          throw new HttpError(409, 'no translation provider configured', 'no_provider')
        }

        const text = await resolveText(song)
        const hash = LyricsCache.hash(text)
        const kind = `translation.${lang}`

        const cached = await container.lyricsCache.read<TranslatedLyrics>(song.id, kind, hash)
        if (cached) return cached

        try {
          const result = await container.translation.translate(text, lang, provider)
          await container.lyricsCache.write(song.id, kind, hash, result)
          return result
        } catch (error) {
          if (error instanceof TranslationError) {
            const status = error.code === 'no_key' ? 409 : 424
            throw new HttpError(status, error.message, error.code)
          }
          throw error
        }
      },
    ),
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

  /** Only "is a key set" ever leaves the server. */
  router.get(
    '/settings/secrets',
    route({}, (): SecretsStatus => container.secrets.status()),
  )

  router.put(
    '/settings/secrets',
    route({ body: SetSecretSchema }, ({ body }): SecretsStatus => {
      container.secrets.setApiKey(body.provider, body.key)
      return container.secrets.status()
    }),
  )

  return router
}
