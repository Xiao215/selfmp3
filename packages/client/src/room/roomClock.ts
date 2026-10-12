/**
 * The doorman's clock, as seen from this device: how far ahead of this
 * device's clock it runs. A room says when its song started on the doorman's
 * clock (`RoomPlaying`), so every member's progress, and on everyone's phones
 * every member's audio, follows from one number.
 *
 * Measured by pings on the room's socket. Each answer says the doorman's time
 * when it answered; halfway through the round trip is the best guess at when
 * that was here. The guess is only as good as the trip was even, and a short
 * trip cannot be very uneven, so the sample with the shortest trip of the
 * last few is the one believed.
 */

export interface ClockSample {
  /** This device's clock when the ping went. */
  readonly sentAt: number
  /** This device's clock when the answer came. */
  readonly receivedAt: number
  /** The doorman's clock in the answer. */
  readonly serverTime: number
}

/** Samples kept: a minute of pings at the socket's pace. */
export const CLOCK_SAMPLES = 6

/** The samples to keep after this one: the newest few. */
export function withClockSample(
  samples: readonly ClockSample[],
  sample: ClockSample,
): ClockSample[] {
  if (sample.receivedAt < sample.sentAt) return [...samples]
  return [...samples, sample].slice(-CLOCK_SAMPLES)
}

/** Doorman time minus this device's time, in ms; 0 before anything was measured. */
export function clockOffset(samples: readonly ClockSample[]): number {
  let best: ClockSample | null = null
  for (const sample of samples) {
    const trip = sample.receivedAt - sample.sentAt
    if (!best || trip < best.receivedAt - best.sentAt) best = sample
  }
  if (!best) return 0
  return best.serverTime - (best.sentAt + best.receivedAt) / 2
}

/**
 * How far a device's audio may drift from the room's before it seeks to catch
 * up. Below this a seek is a stutter nobody would have noticed the drift for.
 */
const ROOM_DRIFT_SECONDS = 0.35

/** Whether a member's player, at `position`, should seek to `expected`. */
export function shouldResync(position: number, expected: number): boolean {
  return Math.abs(position - expected) > ROOM_DRIFT_SECONDS
}
