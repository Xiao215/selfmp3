/**
 * What the services that ask other sites for things have in common.
 */

/** How a service fetches: the platform's `fetch`, or a test's stand-in for it. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

/**
 * The User-Agent sent where a site answers browsers and not much else: the
 * Spotify embed page, 网易云's web API. Sites that ask for a contact address
 * instead (lrclib, MusicBrainz) get `USER_AGENT` from config.ts.
 */
export const BROWSER_USER_AGENT = 'Mozilla/5.0 (Macintosh) self.mp3'

/**
 * A response's body, or null if it runs past `limit` bytes.
 *
 * Read in chunks rather than through `arrayBuffer()`, so an unannounced huge
 * response is dropped as it arrives instead of after it has all been held.
 */
export async function readCapped(response: Response, limit: number): Promise<Buffer | null> {
  if (!response.body) return null
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength
    if (total > limit) return null
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}
