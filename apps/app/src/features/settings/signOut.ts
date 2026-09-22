/**
 * Signing this device out of the cloud.
 *
 * The order matters, and each step is the caller's to supply so the order can
 * be tested without a doorman, a bucket or a device:
 *
 * 1. Stop the music, and empty the queue. First, before anything is taken
 *    away: the songs it is playing are about to be deleted and the library
 *    they came from forgotten, and a device that has signed out and is still
 *    singing is plainly wrong — it went on playing all the way to Welcome
 *    (Xiao, 2026-09-22).
 * 2. One last try at sending the changes made here. It may fail (offline, the
 *    doorman busy); signing out goes on regardless, which the confirmation
 *    warned about.
 * 3. End the session at the doorman and forget it on this device.
 * 4. Forget the replica of the library, and the songs kept for it. Songs are
 *    kept under this account's ids, and another account's library would hand
 *    the same ids to other songs, so nothing kept may outlive the account.
 * 5. Forget the saved library, for the same reason.
 * 6. Hand back to the app, which returns to Welcome (`SIGNED_OUT_ROUTE`).
 */
export interface SignOutSteps {
  readonly stopPlaying: () => void
  readonly sendPendingChanges: () => Promise<void>
  readonly endSession: () => Promise<void>
  readonly forgetLibrary: () => Promise<void>
  readonly removeDownloads: () => Promise<void>
  readonly forgetSavedLibrary: () => Promise<void>
  readonly done: () => void
}

/**
 * Where a device goes once it has signed out: Welcome, the one way in
 * (docs/ui-mock `S3`, "Sign out returns here").
 */
export const SIGNED_OUT_ROUTE = '/welcome'

export async function signOutOfCloud(steps: SignOutSteps): Promise<void> {
  steps.stopPlaying()
  await steps.sendPendingChanges().catch(() => undefined)
  await steps.endSession()
  await Promise.allSettled([
    steps.forgetLibrary(),
    steps.removeDownloads(),
    steps.forgetSavedLibrary(),
  ])
  steps.done()
}

/** The confirmation's words, with what would be lost if it cannot be sent now. */
export function signOutWarning(pendingChanges: number): string {
  const base = 'Songs downloaded to this device are removed; your music stays in the bucket.'
  if (pendingChanges <= 0) return base
  const one = pendingChanges === 1
  return `${base} ${pendingChanges} change${one ? '' : 's'} made here ${one ? 'has' : 'have'} not reached it yet and will be lost if ${one ? 'it' : 'they'} cannot be sent now.`
}
