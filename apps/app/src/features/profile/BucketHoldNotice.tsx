import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { useBucketHold } from './useBucketHold'
import { showToast } from '../../ui/toast'

/**
 * Says, once, that the bucket has refused for the day (docs/SYNC.md, "Caps").
 * Draws nothing.
 *
 * Without this the day's cap showed up as everything else: songs skipped one
 * after another, letter tiles where covers were, a song remembered as having
 * no words. The player still names the song it could not play; this names the
 * reason, the first time, in the doorman's words — which say what to do.
 * For as long as the hold lasts, Settings says so under its title and on
 * Account › Storage, and the sidebar under the library's name.
 */
export function BucketHoldNotice(): ReactNode {
  const hold = useBucketHold()
  const said = useRef<number | null>(null)
  useEffect(() => {
    if (hold === null || said.current === hold.until) return
    said.current = hold.until
    showToast(hold.message, 'warn', { autoDismissMs: 12_000 })
  }, [hold])
  return null
}
