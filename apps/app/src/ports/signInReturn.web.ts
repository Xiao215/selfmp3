import { appPath } from './appPath'
import { onSignInLink } from './deepLinks'
import { desktop } from './desktop/bridge'
import { createSignInInbox, signInLink, type SignInTarget } from './signInCodes'

/**
 * Coming back from Google, in a browser or the installed desktop app: to
 * Welcome, or to Settings → Cloud.
 *
 * In a browser the doorman sends the tab back to this site's `/welcome` or
 * `/settings` with the code in the fragment. It is read once, when the page
 * loads, and taken out of the address so a reload cannot spend it twice.
 *
 * The installed app has no address to be sent back to — the sign-in happened in
 * the person's own browser, because Google refuses to sign in inside an
 * embedded window — so it comes back by `selfmp3://welcome` or
 * `selfmp3://settings`, the same scheme a phone uses. `ports/deepLinks` holds
 * them from the moment the shell hands them over, which on a cold launch is
 * before the page is listening.
 */

const inbox = createSignInInbox()

if (desktop) {
  onSignInLink(url => {
    inbox.arrive(url)
  })
} else if (typeof window !== 'undefined' && signInLink(window.location.href)) {
  inbox.arrive(window.location.href)
  window.history.replaceState(null, '', window.location.pathname + window.location.search)
}

/** Where the doorman should send Google back to, for a sign-in started from `target`. */
export function signInReturnUrl(target: SignInTarget): string {
  if (desktop) return `selfmp3://${target}`
  return `${window.location.origin}${appPath(target)}`
}

/** Codes coming back to `target`: any that already arrived, then each as it comes. */
export function onSignInCode(target: SignInTarget, listener: (code: string) => void): () => void {
  return inbox.listen(target, listener)
}
