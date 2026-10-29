import { z } from 'zod'

/**
 * An artist's picture: the wide one YouTube Music draws behind the artist's
 * name, which lights the artist's page here, and the same picture cut square,
 * the face beside the artist's name in Stats. The server finds and keeps both;
 * this says whether it has them. `rev` names the copies kept, for the address
 * either is then drawn from (`GET /api/artists/backdrop/image`).
 */
export const ArtistPictureShapeSchema = z.enum(['banner', 'portrait'])
export type ArtistPictureShape = z.infer<typeof ArtistPictureShapeSchema>

export const ArtistBackdropSchema = z.object({
  rev: z.string().nullable(),
})
export type ArtistBackdrop = z.infer<typeof ArtistBackdropSchema>

/** The most other names an artist keeps, and the longest one. */
export const ARTIST_NAMES_MAX = 20
export const ARTIST_NAME_MAX = 100

/**
 * The names an artist also goes by, which search finds them by: 周杰伦 as
 * "Jay Chou", 幾田りら as "ikura". The server fills them in from MusicBrainz
 * (services/artistNames.ts), and anyone can change them on the artist's page;
 * the latest change wins, wherever it was made.
 */
export const ArtistNamesSchema = z
  .array(z.string().trim().min(1).max(ARTIST_NAME_MAX))
  .max(ARTIST_NAMES_MAX)

/** `PUT /api/artists/names`: an artist's other names, all of them, as they should be now. */
export const SetArtistNamesSchema = z.object({
  /** The artist as the songs write them; compared as `artistKey` compares. */
  artist: z.string().trim().min(1).max(500),
  names: ArtistNamesSchema,
})
export type SetArtistNames = z.infer<typeof SetArtistNamesSchema>
