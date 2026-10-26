import { BUCKET_CAP_CODE, DOORMAN_ERROR, DoormanError } from '@selfmp3/shared'

/**
 * Whether the doorman — and the bucket behind it — is answering this device,
 * as the last request to it found.
 *
 * A cloud library is this device's own copy, so it always loads: nothing that
 * reads the library ever fails, and a screen that went by the library's
 * errors kept a green dot and "All saved" while the doorman was down, an edit
 * sat unsent, and a song not on this device would not play. The requests that
 * do go out — a look at the bucket, an edit sent, a song fetched — say how it
 * stands instead, and the screens read it from here.
 *
 *   unreachable  nothing answered: the doorman is down, or this device cannot
 *                get to it (a firewall, Wi-Fi with no internet behind it)
 *   failing      the doorman answered with an error of its own, or could not
 *                get to the bucket
 *   capped       the bucket refused a write for the day: an edit waits until
 *                the cap resets or is raised (reads have their own hold,
 *                hold.ts, which keeps them from being asked at all)
 *
 * Any answer ends trouble with the doorman itself; trouble with the bucket
 * behind it ends when the bucket answers, and a refused write when a write
 * goes up — the doorman answering for itself says nothing about either. One
 * for the whole app, like the hold: the doorman is one thing.
 */

export interface DoormanTrouble {
  readonly kind: 'unreachable' | 'failing' | 'capped'
  /** What went wrong, in the doorman's words or the network's. */
  readonly message: string
  /** The bucket behind the doorman, not the doorman: only the bucket answering ends it. */
  readonly bucket: boolean
}

let trouble: DoormanTrouble | null = null
const listeners = new Set<(trouble: DoormanTrouble | null) => void>()

/** How it stood when the doorman was last asked: null while it answers. */
export function doormanTrouble(): DoormanTrouble | null {
  return trouble
}

/** Hear it change. */
export function onDoormanTrouble(listener: (trouble: DoormanTrouble | null) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * What a request to the doorman came to: `answer` true for a response,
 * otherwise the error it threw. `bucket` is a request the doorman passes on
 * to the bucket — a file read, put or taken out, a folder listed — and
 * `write` one that puts a file in or takes one out.
 */
export function noteDoormanAnswer(
  outcome: { bucket: boolean; write: boolean } & ({ answer: true } | { error: unknown }),
): void {
  if ('answer' in outcome) {
    if (trouble === null) return
    if (trouble.kind === 'capped' ? !outcome.write : trouble.bucket && !outcome.bucket) return
    set(null)
    return
  }
  const { error } = outcome
  if (!(error instanceof DoormanError)) return
  if (error.status === 0) {
    set({ kind: 'unreachable', message: error.message, bucket: false })
    return
  }
  if (error.code === BUCKET_CAP_CODE) {
    // A read refused for the day is the hold's (hold.ts), and a write is this.
    if (outcome.write) set({ kind: 'capped', message: error.message, bucket: true })
    return
  }
  const ofBucket = error.code === DOORMAN_ERROR.bucketUnreachable
  if (error.status >= 500 || ofBucket) {
    set({ kind: 'failing', message: error.message, bucket: ofBucket })
  }
}

/**
 * Nothing answered a request made somewhere else: a song the browser's
 * service worker or the desktop shell fetched from the bucket for the player.
 */
export function noteDoormanUnreachable(message = 'Your storage can’t be reached'): void {
  set({ kind: 'unreachable', message, bucket: false })
}

/** Signed out: whatever the last account's doorman said is not this one's. */
export function forgetDoormanTrouble(): void {
  set(null)
}

function set(next: DoormanTrouble | null): void {
  if (
    next?.kind === trouble?.kind &&
    next?.message === trouble?.message &&
    next?.bucket === trouble?.bucket
  ) {
    return
  }
  trouble = next
  for (const listener of [...listeners]) listener(trouble)
}
