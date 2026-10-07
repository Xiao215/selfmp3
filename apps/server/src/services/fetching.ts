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
