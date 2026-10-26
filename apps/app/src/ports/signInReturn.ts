import * as Linking from 'expo-linking'
import { DEEP_LINK_SCHEME } from '@selfmp3/shared'

import { createSignInInbox, type SignInBack, type SignInTarget } from './signInCodes'

/**
 * Coming back from Google, on a phone: to Welcome.
 *
 * The doorman sends Safari back to `selfmp3://welcome` with the code in the
 * fragment. Expo Router opens that screen; the link itself
 * is read here — the one that launched the app, and any that arrive while it is
 * open — into an inbox that keeps it until the screen is listening. Nobody types
 * the code: the doorman never shows it when it has somewhere to send it.
 */

const inbox = createSignInInbox()

void Linking.getInitialURL().then(url => {
  if (url) inbox.arrive(url)
})
Linking.addEventListener('url', event => {
  inbox.arrive(event.url)
})

/** Where the doorman should send Google back to, for a sign-in started from `target`. */
export function signInReturnUrl(target: SignInTarget): string {
  return `${DEEP_LINK_SCHEME}://${target}`
}

/** Sign-ins coming back to `target`: any that already arrived, then each as it comes. */
export function onSignInBack(
  target: SignInTarget,
  listener: (back: SignInBack) => void,
): () => void {
  return inbox.listen(target, listener)
}
