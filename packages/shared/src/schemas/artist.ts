import { z } from 'zod'

/**
 * An artist's picture: the wide one YouTube Music draws behind the artist's
 * name, which lights the artist's page here. The server finds and keeps it;
 * this says whether it has one. `rev` names the copy kept, for the address
 * the picture is then drawn from (`GET /api/artists/backdrop/image`).
 */
export const ArtistBackdropSchema = z.object({
  rev: z.string().nullable(),
})
export type ArtistBackdrop = z.infer<typeof ArtistBackdropSchema>
