/**
 * Hybrid logical clocks (docs/SYNC.md): when a change was made, written so
 * that comparing two stamps as strings says which change wins.
 *
 *   0mfx3k2p1.0000.web-3f9a2c1d
 *   └── ms ─┘ └ n ┘ └─ device ─┘
 *
 * The first part is wall-clock milliseconds; the second counts changes made
 * in the same millisecond, or while this device's clock is behind a stamp it
 * has seen; the device id settles a tie between two devices. Both numbers are
 * fixed-width base 36, so string order is time order.
 *
 * A device whose clock runs fast does not win forever. Every device that sees
 * one of its changes moves its own clock past it, so whatever anyone does
 * next still comes after.
 */

/** Base 36, so good until the year 5188. */
const MS_DIGITS = 9
const COUNTER_DIGITS = 4
const MAX_COUNTER = 36 ** COUNTER_DIGITS - 1

export const HLC_PATTERN = /^[0-9a-z]{9}\.[0-9a-z]{4}\.[a-z0-9][a-z0-9-]{2,62}$/

const DEVICE_PATTERN = /^[a-z0-9][a-z0-9-]{2,62}$/

export interface HlcParts {
  readonly ms: number
  readonly counter: number
  readonly device: string
}

export function formatHlc({ ms, counter, device }: HlcParts): string {
  return `${ms.toString(36).padStart(MS_DIGITS, '0')}.${counter
    .toString(36)
    .padStart(COUNTER_DIGITS, '0')}.${device}`
}

export function parseHlc(hlc: string): HlcParts | null {
  if (!HLC_PATTERN.test(hlc)) return null
  return {
    ms: parseInt(hlc.slice(0, MS_DIGITS), 36),
    counter: parseInt(hlc.slice(MS_DIGITS + 1, MS_DIGITS + 1 + COUNTER_DIGITS), 36),
    device: hlc.slice(MS_DIGITS + COUNTER_DIGITS + 2),
  }
}

/** The wall-clock time in a stamp, in milliseconds. */
export function hlcTime(hlc: string): number {
  return parseHlc(hlc)?.ms ?? 0
}

/** True when a change stamped `incoming` replaces what `current` set. Anything beats nothing. */
export function hlcWins(incoming: string, current: string | null | undefined): boolean {
  return current == null || incoming > current
}

/**
 * One device's clock. Stamps it makes are later than every stamp it has made
 * or seen, and as close to the wall clock as that allows.
 */
export class HlcClock {
  readonly device: string
  readonly #now: () => number
  #ms = 0
  #counter = 0

  constructor(device: string, options: { now?: () => number; last?: string | null } = {}) {
    if (!DEVICE_PATTERN.test(device)) throw new Error(`not a device id: ${device}`)
    this.device = device
    this.#now = options.now ?? Date.now
    if (options.last) this.observe(options.last)
  }

  /** A stamp for a change made now. */
  tick(): string {
    const wall = Math.floor(this.#now())
    if (wall > this.#ms) {
      this.#ms = wall
      this.#counter = 0
    } else if (this.#counter < MAX_COUNTER) {
      this.#counter++
    } else {
      this.#ms++
      this.#counter = 0
    }
    return formatHlc({ ms: this.#ms, counter: this.#counter, device: this.device })
  }

  /** Move past a stamp from anywhere, so the next tick comes after it. */
  observe(hlc: string): void {
    const parts = parseHlc(hlc)
    if (!parts) return
    if (parts.ms > this.#ms || (parts.ms === this.#ms && parts.counter > this.#counter)) {
      this.#ms = parts.ms
      this.#counter = parts.counter
    }
  }

  /** The latest stamp made or seen, to carry the clock across a restart. */
  get last(): string | null {
    return this.#ms === 0 && this.#counter === 0
      ? null
      : formatHlc({ ms: this.#ms, counter: this.#counter, device: this.device })
  }
}
