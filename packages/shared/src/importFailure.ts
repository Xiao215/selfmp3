/**
 * Why an import failed, or a link could not be looked up, in a few plain words.
 *
 * A failed job carries what the server knew: yt-dlp's own last line
 * ("[youtube] FDXohHp9Jso: This video is only available to Music Premium
 * members") or the server's advice for whoever runs it ("…update it (docker
 * compose pull && docker compose up -d), then try again"). Both are right and
 * neither is for the row a person reads, so the row says what happened and,
 * when there is one, what to do; the whole text stays in the job, and in the
 * server's log, for whoever runs it.
 *
 * Matched on words rather than a code because the words are all a failure
 * carries — yt-dlp exits 1 for a private video and a members-only one alike —
 * and on both yt-dlp's wording and the server's own rewrites of it
 * (ytCookies.ts), which replace the first with the second on the way up.
 * First match wins, so the narrower reasons come before the broad ones.
 */

/** When nothing below fits: still true, and still says what to do. */
const IMPORT_FAILED = 'Couldn’t download it. Try again later.'

const REASONS: readonly (readonly [RegExp, string])[] = [
  [/music premium|youtube premium|premium members/, 'Needs YouTube Premium.'],
  [
    /members[- ]only|join this channel|available to this channel'?s members/,
    'Only for the channel’s members.',
  ],
  [/confirm your age|age[- ]restricted|inappropriate for some users/, 'Age-restricted on YouTube.'],
  [/private video|video is private/, 'This video is private.'],
  [
    /not (?:made this video )?available in your country|blocked it in your country|geo[- ]?restrict|not available in your region/,
    'Not available in this country.',
  ],
  [
    /video unavailable|video is unavailable|has been removed|no longer available|account associated with this video has been terminated|copyright claim/,
    'This video isn’t on YouTube any more.',
  ],
  [/a playlist, not one song/, 'That’s a playlist. Look it up again to pick its songs.'],
  [/second preview/, '网易云 only gave a preview. Look it up again.'],
  // Rate limits normally wait in the queue rather than fail; one that failed still says so.
  [
    /rate-limiting|not a bot|http error 429|too many requests|pacing requests|unusual traffic/,
    'YouTube asked us to slow down. Try again later.',
  ],
  [/http error 403|refused the download/, 'YouTube refused it. Try again later.'],
  // The server's "only shows that to a signed-in account", before the cookie words below.
  [/signed-in account/, 'Needs a signed-in YouTube account.'],
  [/cookie|keychain|full disk access|signed-in session/, 'Your YouTube sign-in isn’t working.'],
  [/sign in|login required|log in/, 'Needs a signed-in YouTube account.'],
  [/yt-dlp is not installed/, 'yt-dlp isn’t installed.'],
  [/no space left|disk full|enospc/, 'Your library’s computer is out of space.'],
  [
    /timed out|timeout|getaddrinfo|enotfound|econnreset|econnrefused|network|connection|unable to download webpage|name resolution/,
    'Couldn’t connect. Try again later.',
  ],
  [
    /nothing to import|no (?:video|results|entries) found|could not work out a title|could not read that link|does not exist|not found/,
    'Couldn’t find this song.',
  ],
]

/** The plain sentence for a failed import's `error`. */
export function importFailure(error: string | null): string {
  if (!error) return IMPORT_FAILED
  const lower = error.toLowerCase()
  return REASONS.find(([pattern]) => pattern.test(lower))?.[1] ?? IMPORT_FAILED
}

/** When nothing below fits a look-up: the link, not the song, is what could not be read. */
const LOOK_UP_FAILED = 'Couldn’t read that link.'

/**
 * A look-up's own reasons, before a download's: a page that is not there is
 * nothing to import, not a connection to try again.
 */
const LOOK_UP_REASONS: readonly (readonly [RegExp, string])[] = [
  [/http error 404|unsupported url|404: not found/, 'There’s nothing to import at that link.'],
  ...REASONS,
]

/**
 * The plain sentence for a link yt-dlp could not read when it was looked up
 * ("[youtube] zzzzzzzzzzz: This video is unavailable"): the server sends this
 * rather than yt-dlp's own words.
 */
export function lookUpFailure(error: string): string {
  const lower = error.toLowerCase()
  return LOOK_UP_REASONS.find(([pattern]) => pattern.test(lower))?.[1] ?? LOOK_UP_FAILED
}
