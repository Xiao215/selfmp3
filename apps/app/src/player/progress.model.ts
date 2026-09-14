/**
 * The player's fast-moving facts, kept outside React state.
 *
 * The position moves about four times a second in a browser and once a second
 * on a phone. Held in the provider's state, every tick re-rendered the provider
 * and everything that asked for the position only to copy it into a ref — the
 * root shell among them, so the whole frame redrew four times a second while a
 * song played. A store with `get` and `subscribe` lets the few things that draw
 * the position subscribe (through `useSyncExternalStore`), and lets the rest
 * read it when they need it, which is what a heartbeat or a saved session wants.
 *
 * Pure, so vitest runs it: no React, no engine.
 */

/** Where the song has got to. Read it only where a scrubber or a synced line needs it. */
export interface PlayerProgress {
  readonly position: number
  readonly duration: number
}

export interface ValueStore<T> {
  get: () => T
  /** Replaces the value, and tells subscribers only when it actually changed. */
  set: (next: T) => void
  subscribe: (listener: () => void) => () => void
}

/**
 * The smallest external store: a value, and who to tell when it changes.
 * `equal` decides "changed", so an object rebuilt with the same fields is not
 * a change and wakes nobody.
 */
export function createValueStore<T>(
  initial: T,
  equal: (a: T, b: T) => boolean = Object.is,
): ValueStore<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: next => {
      if (equal(value, next)) return
      value = next
      for (const listener of listeners) listener()
    },
    subscribe: listener => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export interface ProgressStore {
  /** The same object until the position or duration changes, as `useSyncExternalStore` requires. */
  get: () => PlayerProgress
  getPosition: () => number
  set: (position: number, duration: number) => void
  subscribe: (listener: () => void) => () => void
}

export function createProgressStore(): ProgressStore {
  const store = createValueStore<PlayerProgress>(
    { position: 0, duration: 0 },
    (a, b) => a.position === b.position && a.duration === b.duration,
  )
  return {
    get: store.get,
    getPosition: () => store.get().position,
    set: (position, duration) => store.set({ position, duration }),
    subscribe: store.subscribe,
  }
}

/** Which song is loaded and whether it is sounding: what a song row needs to know. */
export interface SongPlaybackState {
  readonly songId: number | null
  readonly playing: boolean
}

export function samePlayback(a: SongPlaybackState, b: SongPlaybackState): boolean {
  return a.songId === b.songId && a.playing === b.playing
}

/**
 * One row's view of the player: `playing` or `paused` for the loaded song, and
 * null for every other row. A primitive, so a song change wakes the two rows
 * whose answer changed and a pause wakes one — not the whole list.
 */
export function songPlayback(state: SongPlaybackState, songId: number): 'playing' | 'paused' | null {
  if (state.songId !== songId) return null
  return state.playing ? 'playing' : 'paused'
}

/**
 * Whether two engine states differ in anything but the clock.
 *
 * The clock — the position, the duration, how much is buffered — goes to the
 * progress store. Everything else (playing, volume, loop points…) is rare, and
 * is what the provider still keeps in state.
 */
export function differsBesidesClock<T extends { currentTime: number; duration: number; buffered: number }>(
  a: T,
  b: T,
): boolean {
  for (const key of Object.keys(b) as (keyof T)[]) {
    if (key === 'currentTime' || key === 'duration' || key === 'buffered') continue
    if (a[key] !== b[key]) return true
  }
  return false
}

/** Where the position was last reported to something that extrapolates it. */
export interface ReportedPosition {
  readonly position: number
  /** Milliseconds, as `Date.now()`. */
  readonly at: number
  readonly playing: boolean
  readonly rate: number
}

/**
 * A seek, told apart from the song simply playing on.
 *
 * The OS's Now Playing card runs its own clock from the last position it was
 * given, so it needs telling only when the position stops agreeing with that
 * clock: a jump further than the time that passed would explain. `threshold`
 * absorbs the coarse ticks — a phone's are a second apart.
 */
export function positionJumped(
  last: ReportedPosition,
  position: number,
  now: number,
  threshold = 1.5,
): boolean {
  const expected = last.playing ? last.position + ((now - last.at) / 1000) * last.rate : last.position
  return Math.abs(position - expected) > threshold
}
