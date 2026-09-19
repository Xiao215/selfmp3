import { prefs } from '../../ports/prefs'
import { FIRST_SYNC_KEY, FIRST_SYNC_SEEN } from './firstSync.model'

/**
 * Whether this device has seen First sync, kept with its other preferences.
 *
 * Per device and not per account on purpose: the page is about this device
 * receiving a library and how much of it to keep, and signing out and back in
 * does not make the device new. Kept apart from the model because the prefs
 * port reads a file on a phone, which a pure test cannot.
 */
export function storedFirstSync(): string | null {
  return prefs.get(FIRST_SYNC_KEY)
}

export function rememberFirstSyncSeen(): void {
  prefs.set(FIRST_SYNC_KEY, FIRST_SYNC_SEEN)
}
