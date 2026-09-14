import { appPath } from './appPath'
import { desktop } from './desktop/bridge'

/**
 * Coming back from Google to Settings → Cloud, in a browser: the web app's
 * `SignInReturn`. Google's sign-in sends the tab back to this page with the
 * code that claims the session in the fragment; it is read once and cleared
 * from the address so a reload cannot spend it twice.
 *
 * The installed app has no address to be sent back to — the sign-in happened in
 * the person's own browser, because Google refuses to sign in inside an
 * embedded window — so it comes back by `selfmp3://`, the same scheme and the
 * same fragment the phone already uses. The shell holds a link that arrives
 * before the page is listening, which a cold launch from a sign-in always is.
 */

/** Links the shell delivered, oldest first, until something takes them. */
const arrived: string[] = []
if (desktop) desktop.onDeepLink(url => arrived.push(url))

export function signInReturnUrl(): string | null {
  if (desktop) return 'selfmp3://sign-in'
  return `${window.location.origin}${appPath('settings')}`
}

export function takeSignInCode(): string | null {
  if (desktop) {
    const url = arrived.shift()
    return url === undefined
      ? null
      : (/(?:^|[#&])signin-code=([0-9A-Za-z-]{1,32})/.exec(url)?.[1] ?? null)
  }
  const raw = /(?:^|[#&])signin-code=([0-9A-Za-z-]{1,32})/.exec(window.location.hash)?.[1]
  if (raw === undefined) return null
  window.history.replaceState(null, '', window.location.pathname + window.location.search)
  return raw
}
