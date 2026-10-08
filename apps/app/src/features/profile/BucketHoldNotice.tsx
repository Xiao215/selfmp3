import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { useBucketHold } from './useBucketHold'
import { showToast } from '../../ui/toast'
import { deviceKind } from '../../ports/device'
import { untilCapResets } from '../library/library.model'
import { devicePlace } from '../settings/settings.model'

/**
 * Says, once, that the bucket has refused for the day (docs/SYNC.md, "Caps").
 * Draws nothing.
 *
 * Without this the day's cap showed up as everything else: songs skipped one
 * after another, letter tiles where covers were, a song remembered as having
 * no words. The player still names the song it could not play; this names the
 * reason, the first time, in plain words: the doorman's own message talks
 * about Backblaze and its caps, which only Account › Storage has explained.
 * For as long as the hold lasts, Settings says so under its title and on
 * Account › Storage, and a computer's sidebar in a card at its foot.
 */
export function BucketHoldNotice(): ReactNode {
  const hold = useBucketHold()
  // Once for the day, not each time the hold is renewed: it lapses and is
  // asked about again every ten minutes, and each renewal said it again
  // (2026-10-08). Library's line and the faded rows say it from then on.
  const saidAt = useRef<number | null>(null)
  useEffect(() => {
    if (hold === null) return
    const now = Date.now()
    if (saidAt.current !== null && now - saidAt.current < SAY_AGAIN_AFTER_MS) return
    saidAt.current = now
    const place = devicePlace(deviceKind())
    showToast(
      `Your storage’s allowance for today is used up. Songs not on this ${place} come back in about ${untilCapResets(new Date())}.`,
      'warn',
      { autoDismissMs: 12_000 },
    )
  }, [hold])
  return null
}

/** Long enough to cover the rest of a day the cap holds: a new day's cap is news again. */
const SAY_AGAIN_AFTER_MS = 12 * 60 * 60_000
