/**
 * A trailing-edge debounce with a ceiling.
 *
 * Every `trigger()` pushes the call back by `quietMs`, so a burst of events
 * (Finder copying a folder of forty files) becomes one call after things go
 * quiet. `maxWaitMs` guarantees the call still happens during a burst that
 * never quite stops — a very slow copy would otherwise starve the rescan.
 */
export interface Debounced {
  trigger(): void
  /** Drop any pending call. */
  cancel(): void
  readonly pending: boolean
}

export function debounce(fn: () => void, quietMs: number, maxWaitMs = quietMs * 10): Debounced {
  let timer: NodeJS.Timeout | null = null
  let firstTriggeredAt: number | null = null

  const fire = (): void => {
    timer = null
    firstTriggeredAt = null
    fn()
  }

  return {
    trigger() {
      const now = Date.now()
      firstTriggeredAt ??= now
      if (timer) clearTimeout(timer)
      const elapsed = now - firstTriggeredAt
      const wait = Math.max(0, Math.min(quietMs, maxWaitMs - elapsed))
      timer = setTimeout(fire, wait)
      // Never hold the process open just for a pending rescan.
      timer.unref()
    },
    cancel() {
      if (timer) clearTimeout(timer)
      timer = null
      firstTriggeredAt = null
    },
    get pending() {
      return timer !== null
    },
  }
}
