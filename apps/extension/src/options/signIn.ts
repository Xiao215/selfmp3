/**
 * Signing in with Google, from the options page (I3).
 *
 * Google will not redirect to a `chrome-extension://` address, so the doorman
 * is sent to `https://<id>.chromiumapp.org/` instead — an address Chrome
 * intercepts rather than loading, and hands straight back to the flow that
 * asked for it. Nothing is ever fetched from it.
 *
 * It runs here rather than in the worker because the worker does not last:
 * Chrome stops an idle service worker, and a sign-in can sit on Google's
 * password page for minutes. A tab lives as long as its tab. The code in the
 * address Chrome hands back is read with shared's `signInCodeFromUrl`.
 */

/**
 * Chrome's own words for a sign-in that did not finish, turned into ours.
 *
 * Closing the window is by far the commonest of these and is not a failure, so
 * it does not read like one.
 */
export function signInFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/closed|canceled|cancelled|did not approve/i.test(message)) {
    return 'That sign-in window was closed before Google finished.'
  }
  return message || 'That sign-in did not finish.'
}
