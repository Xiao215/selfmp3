/**
 * How often a run of imports publishes a snapshot while it keeps going.
 *
 * Every snapshot is a download for every device that is looking: the change
 * counter moves, so each lists the bucket's two folders and reads the new
 * snapshot. A run that published whenever it paused for 45 seconds published
 * once a song at the pace YouTube allows — about a thousand snapshots on a
 * thousand-song day, and with a phone and a tab open, more listings than
 * Backblaze gives free in a day (docs/SYNC.md, "Caps").
 *
 * So the first snapshot of a run still goes up quickly — one song, or the
 * first of many, shows on every device within a minute — and each one after
 * it waits longer the longer the run has been going: two minutes apart at
 * first, then five, then ten. The last song of a run is published at once by
 * the caller (`cancel`, then its own publish), and a long enough pause ends a
 * run, so the next import is quick again.
 */

interface PacingStep {
  /** From this far into a run… */
  readonly from: number
  /** …snapshots are at least this far apart. */
  readonly every: number
}

const IMPORT_PACING: readonly PacingStep[] = [
  { from: 0, every: 2 * 60_000 },
  { from: 10 * 60_000, every: 5 * 60_000 },
  { from: 30 * 60_000, every: 10 * 60_000 },
]

/** How soon the first snapshot of a run goes up. */
const FIRST_PUBLISH_MS = 45_000

/** A run that has had no import for this long is over; the next starts a new one. */
const RUN_ENDS_AFTER_MS = 15 * 60_000

export interface ImportPacer {
  /** A song of the run is in the bucket, and more are coming: publish when the pace allows. */
  trigger(): void
  /** The run is over (its last song is being published now): drop what was waiting. */
  cancel(): void
}

export function importPacer(
  publish: () => void,
  {
    first = FIRST_PUBLISH_MS,
    steps = IMPORT_PACING,
    endsAfter = RUN_ENDS_AFTER_MS,
  }: { first?: number; steps?: readonly PacingStep[]; endsAfter?: number } = {},
): ImportPacer {
  let run: { startedAt: number; lastAt: number; publishedAt: number | null } | null = null
  let timer: NodeJS.Timeout | null = null

  const spacing = (age: number): number => {
    let every = steps[0]?.every ?? first
    for (const step of steps) if (age >= step.from) every = step.every
    return every
  }

  const schedule = (wait: number): void => {
    timer = setTimeout(
      () => {
        timer = null
        if (run) run.publishedAt = Date.now()
        publish()
      },
      Math.max(0, wait),
    )
    // Never hold the process open just for a pending snapshot.
    timer.unref()
  }

  return {
    trigger() {
      const now = Date.now()
      if (run && now - run.lastAt > endsAfter) run = null
      if (!run) {
        run = { startedAt: now, lastAt: now, publishedAt: null }
        if (timer) clearTimeout(timer)
        schedule(first)
        return
      }
      run.lastAt = now
      // One is already on its way, at the pace the run allows.
      if (timer) return
      const since = run.publishedAt ?? run.startedAt
      schedule(since + spacing(now - run.startedAt) - now)
    },
    cancel() {
      if (timer) clearTimeout(timer)
      timer = null
      run = null
    },
  }
}
