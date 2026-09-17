import type { Settings } from '@selfmp3/shared'
import { isRateLimited } from './ytThrottle.js'

/**
 * YouTube login cookies for yt-dlp.
 *
 * Private playlists and Liked Music only resolve when yt-dlp is signed in,
 * and it can borrow the browser's own session (`--cookies-from-browser`) or
 * read a Netscape `cookies.txt`. This module turns the settings into the
 * right arguments and, when it goes wrong, turns yt-dlp's stderr into
 * something a person can act on. Pure, so both halves are unit-tested.
 */

export type YtCookieSettings = Pick<Settings, 'ytCookieSource' | 'ytCookieBrowser' | 'ytCookieFile'>

/** Extra yt-dlp arguments for the configured cookie source. Empty when none. */
export function cookieArgs(settings: YtCookieSettings): string[] {
  switch (settings.ytCookieSource) {
    case 'browser':
      return ['--cookies-from-browser', settings.ytCookieBrowser]
    case 'file':
      return settings.ytCookieFile.trim() ? ['--cookies', settings.ytCookieFile.trim()] : []
    case 'none':
      return []
  }
}

const BROWSER_LABELS: Record<Settings['ytCookieBrowser'], string> = {
  chrome: 'Chrome',
  safari: 'Safari',
  firefox: 'Firefox',
  brave: 'Brave',
  edge: 'Edge',
  chromium: 'Chromium',
}

function browserLabel(browser: Settings['ytCookieBrowser']): string {
  return BROWSER_LABELS[browser]
}

/**
 * Map a yt-dlp failure to an actionable message.
 *
 * yt-dlp's own errors are accurate but written for people who already know
 * what a cookie database is. The cases below are the ones that actually
 * happen on a Mac; anything else falls through unchanged.
 */
export function explainCookieError(message: string, settings: YtCookieSettings): string {
  const lower = message.toLowerCase()
  const browser = browserLabel(settings.ytCookieBrowser)

  if (settings.ytCookieSource === 'browser') {
    if (
      settings.ytCookieBrowser === 'safari' &&
      /permission denied|operation not permitted|could not find safari|cookies\.binarycookies/.test(
        lower,
      )
    ) {
      return `Couldn’t read Safari’s cookies. macOS protects that file: give the process running self.mp3 (Terminal, or node) Full Disk Access in System Settings → Privacy & Security, then try again.`
    }
    if (/database is locked|locked by another|being used by another process/.test(lower)) {
      return `${browser}’s cookie database is locked — it is open in ${browser} right now. Quit ${browser} and try again, or switch to a cookies.txt file.`
    }
    if (
      /could not (find|copy|open).*cookie|cookies? database|no such file|not found.*cookies/.test(
        lower,
      )
    ) {
      return `Couldn’t find ${browser}’s cookie database. Is ${browser} installed and has it been opened at least once on this server?`
    }
    if (/failed to decrypt|keyring|keychain|dpapi/.test(lower)) {
      return `Couldn’t decrypt ${browser}’s cookies. yt-dlp needs to read the browser’s key from the macOS keychain; allow it when prompted, or use a cookies.txt file instead.`
    }
    if (/unsupported browser|not supported|browser .* is not/.test(lower)) {
      return `This version of yt-dlp can’t read cookies from ${browser}. Update it (brew upgrade yt-dlp) or pick another browser.`
    }
  }

  if (settings.ytCookieSource === 'file') {
    if (/no such file|does not exist|not found|cannot open|errno 2/.test(lower)) {
      return `The cookies file wasn’t found at ${settings.ytCookieFile || '(empty path)'}. Check the path in Settings.`
    }
    if (/netscape|invalid cookies?|not a valid|does not look like/.test(lower)) {
      return `That file isn’t in Netscape cookies.txt format. Export it with a “Get cookies.txt” browser extension.`
    }
  }

  /*
   * Rate limiting first, because it lies about itself.
   *
   * "Sign in to confirm you're not a bot" matches every sign-in pattern below
   * and is not a sign-in problem: YouTube is refusing the whole network for
   * rate, and the advice underneath would send someone to re-export cookies
   * that were never wrong. Worse, doing that under a block risks the account
   * along with the address.
   */
  if (isRateLimited(message)) {
    const raise =
      settings.ytCookieSource === 'none'
        ? ' Setting up YouTube cookies in Settings → Importing raises the limit a long way.'
        : ''
    return (
      'YouTube is rate-limiting this network, which it reports as a bot check — ' +
      'your cookies are not the problem. Downloads pause by themselves and pick ' +
      `up once it lifts.${raise}`
    )
  }

  if (
    /sign in|login required|log in|private|does not exist|not available|unavailable|cookies/.test(
      lower,
    )
  ) {
    return settings.ytCookieSource === 'none'
      ? 'YouTube says that needs a signed-in account. Set up YouTube cookies in Settings → Importing first.'
      : `YouTube didn’t accept the cookies as a signed-in session. Make sure ${
          settings.ytCookieSource === 'browser' ? browser : 'the browser you exported from'
        } is logged in to YouTube Music, then try again. (${message})`
  }

  // The link resolved but the audio itself was refused: YouTube changed how
  // it hands out media URLs and the installed yt-dlp predates the change.
  if (/http error 403/.test(lower)) {
    return `YouTube refused the download (HTTP 403). This almost always means yt-dlp is out of date — run: brew upgrade yt-dlp, then retry.`
  }

  return message
}
