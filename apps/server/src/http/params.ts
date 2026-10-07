import { z } from 'zod'
import { IdSchema, type Song } from '@selfmp3/shared'
import type { SongRepository } from '../repositories/songs.js'
import { HttpError } from './errors.js'

/** `/…/:id` for a numeric id: the params schema every such route parses. */
export const ParamsWithId = z.object({ id: IdSchema })

/** Look a song up, or fail with a proper 404 rather than an undefined later. */
export function requireSong(songs: Pick<SongRepository, 'byId'>, id: number): Song {
  const song = songs.byId(id)
  if (!song) throw HttpError.notFound(`no song with id ${id}`)
  return song
}
