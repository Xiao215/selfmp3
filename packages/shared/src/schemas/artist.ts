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
