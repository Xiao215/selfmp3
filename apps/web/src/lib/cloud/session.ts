import { createCloudSession } from '@selfmp3/cloud'
import { webPlatform } from './webPlatform.js'

/**
 * The web app's session, which is `@selfmp3/cloud`'s with a browser behind it.
 *
 * The rules — what a session is, how an attempt is claimed, when a code has
 * been spent — are in the package, because the phone needs the same ones. What
 * is left here is the binding: this browser's storage, its `fetch`, and the
 * address the doorman can send Google back to, which a native app does not
 * have. Every caller goes on importing the same names from the same place.
 */

const session = createCloudSession(webPlatform)

export const {
  loadSession,
  saveSession,
  forgetSession,
  pendingSignIn,
  clearPendingSignIn,
  beginSignIn,
  claimSignIn,
  refreshSession,
  connectStorage,
  signOut,
  doormanFetch,
} = session

export { DoormanError, SESSION_KEY } from '@selfmp3/cloud'
export type { ClaimOutcome, CloudSession } from '@selfmp3/cloud'
