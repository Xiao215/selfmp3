/**
 * When the server stops recognising this phone.
 *
 * A 401 can arrive from anywhere — a screen's query, the download queue, the
 * playback service reaching for the next song — and two of those three are
 * outside the component tree, where there is no context to read and no hook to
 * call. So it is a plain module: whoever notices says so here, and the one
 * place that can do something about it listens.
 *
 * Only `api/client.ts` raises it, because every request the phone makes goes
 * through that file, and only `ConnectionProvider` listens, because signing
 * back in is its business. One listener rather than a set: a second would mean
 * two things trying to sign you in at once.
 */

let listener: (() => void) | null = null

/**
 * Be told when the server refuses this phone. Returns the unsubscribe.
 *
 * Registering a second listener replaces the first, which is what a provider
 * remounting in development should do.
 */
export function onSessionExpired(handler: () => void): () => void {
  listener = handler
  return () => {
    if (listener === handler) listener = null
  }
}

/**
 * Say the server refused this phone.
 *
 * Safe to call on every 401 of a burst: a screen, the download queue and the
 * playback service can each hit one within the same second, and the listener's
 * job is to make that idempotent rather than this one's to count.
 */
export function sessionExpired(): void {
  listener?.()
}
