import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { bucketHold, onBucketHold, type BucketCall, type BucketHold } from '@selfmp3/replica'

/**
 * The bucket refusing for the day, for a screen to say so
 * (packages/replica/src/hold.ts). Null while the bucket may be asked.
 *
 * Here rather than in `@selfmp3/client`, which has no timers by design: a hold
 * ends on its own, and a notice should come down when it does, not when the
 * next read happens to notice.
 */
export function useBucketHold(
  /** One kind of call — the reads, which downloads are — or, left out, either. */
  call?: BucketCall,
): BucketHold | null {
  const read = useCallback(() => bucketHold(call), [call])
  const hold = useSyncExternalStore(onBucketHold, read, () => null)
  useEffect(() => {
    if (hold === null) return
    // Asking is what lets a lapsed hold go, and the listeners hear it.
    const timer = setTimeout(() => bucketHold(), Math.max(0, hold.until - Date.now()) + 1)
    return () => clearTimeout(timer)
  }, [hold])
  return hold
}
