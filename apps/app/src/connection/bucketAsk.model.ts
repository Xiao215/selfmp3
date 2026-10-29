import type { BucketHold } from '@selfmp3/replica'

/** How long a hold must have stood before looking at the page again asks early. */
export const ASK_ON_RETURN_AFTER_MS = 60_000

/**
 * How long after the last refusal a song pressed may ask early, itself being
 * the asking: one request a press at most, and none for a row of presses.
 */
export const ASK_ON_PLAY_AFTER_MS = 15_000

/** How long before a hold runs out its asking starts, so the answer comes while it still stands. */
export const ASK_BEFORE_END_MS = 1_000

/**
 * The moments the app asks the bucket again early, while it refuses for the
 * day (packages/replica/src/hold.ts): the page looked at again, a song pressed
 * that the hold would refuse. A hold about to run out asks too
 * (`useAskBucketBack`).
 */
type BucketAskMoment = 'returned' | 'play'

/**
 * Whether to ask now (`useAskBucketAgain`). Without this
 * a raised cap went unnoticed until someone pressed Try again (R2-M9).
 * `refusals` is `bucketRefusals()`.
 */
export function askBucketNow(
  moment: BucketAskMoment,
  hold: BucketHold | null,
  refusals: number,
  now: number,
): boolean {
  // Run out while nobody was looking, and nothing has asked since.
  if (hold === null) return moment === 'returned' && refusals > 0
  switch (moment) {
    case 'returned':
      return now - hold.heardAt >= ASK_ON_RETURN_AFTER_MS
    case 'play':
      return now - hold.heardAt >= ASK_ON_PLAY_AFTER_MS
  }
}
