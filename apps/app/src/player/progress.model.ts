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

/**
 * What one seek moves the song by, in seconds. Ten is the podcast convention,
 * and it is the same step wherever the ask comes from — a menu item, a media
 * key, a headset, a lock screen — so a jump is the same jump everywhere.
 */
export const SEEK_STEP_SECONDS = 10
/** What one press of volume up or down moves the level by, on a 0–1 scale. */
export const VOLUME_STEP = 0.05

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
  /**
   * A tick, and the song the engine was timing when it made it. A tick for any
   * other song is dropped rather than drawn: see `follow`.
   */
  set: (songId: number | null, position: number, duration: number) => void
  /**
   * The clock is this song's from now on, starting at `startAt` — the moment
   * the queue moved, not the moment the player caught up.
   *
   * Changing songs is not instant: the engine goes on playing the song it is
   * leaving while it opens the next one, and a phone's player reports its
   * position only once a second. Without this the bar under the new song's
   * name kept the old song's position until that first tick — a fraction of a
   * second of the wrong song's progress, already in the new song's colour, and
   * then a jump back to 0:00. So the position starts again here, and ticks
   * still in flight for the song before are not the new song's position.
   *
   * Following the song already being followed, with no `startAt`, leaves the
   * clock where it is: that is asking for the song that is sounding, which the
   * engine leaves playing rather than starting again.
   */
  follow: (songId: number | null, startAt?: number) => void
  subscribe: (listener: () => void) => () => void
}

export function createProgressStore(): ProgressStore {
  const store = createValueStore<PlayerProgress>(
    { position: 0, duration: 0 },
    (a, b) => a.position === b.position && a.duration === b.duration,
  )
  // Null until something is loaded, which is what the engine reports too.
  let timing: number | null = null
  return {
    get: store.get,
    getPosition: () => store.get().position,
    set: (songId, position, duration) => {
      if (songId !== timing) return
      store.set({ position, duration })
    },
    follow: (songId, startAt) => {
      const again = timing === songId
      timing = songId
      if (again && startAt === undefined) return
      // Length unknown again: the song's own is what the scrubber falls back
      // to (`usePlayerProgress`), and the engine says the real one on its
      // first tick.
      store.set({ position: startAt ?? 0, duration: 0 })
    },
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
 * The level, as the engine has it. Its own store because a drag of the volume
 * slider and the sleep timer's fade each set it many times a second, and
 * nothing but the volume control draws it.
 */
export interface VolumeState {
  /** 0–1; the bar's slider and the web's share one scale. */
  readonly volume: number
  readonly muted: boolean
}

export function sameVolume(a: VolumeState, b: VolumeState): boolean {
  return a.volume === b.volume && a.muted === b.muted
}

/**
 * The practice tools' state: the loop, its count-in, and the speed with
 * whether the pitch follows it. Read by the practice panel and the two chips
 * that say a loop or a speed is on; the count-in flips on every restart of
 * the loop, which is why it does not ride in `PlayerApi`.
 */
export interface PracticeState {
  readonly loopA: number | null
  readonly loopB: number | null
  /** The pause before a loop starts again, while it is happening. */
  readonly countingIn: boolean
  /** Playback speed: 1 is normal. */
  readonly rate: number
  readonly preservesPitch: boolean
}

export function samePractice(a: PracticeState, b: PracticeState): boolean {
  return (
    a.loopA === b.loopA &&
    a.loopB === b.loopB &&
    a.countingIn === b.countingIn &&
    a.rate === b.rate &&
    a.preservesPitch === b.preservesPitch
  )
}

/**
 * One row's view of the player: `playing` or `paused` for the loaded song, and
 * null for every other row. A primitive, so a song change wakes the two rows
 * whose answer changed and a pause wakes one — not the whole list.
 */
export function songPlayback(
  state: SongPlaybackState,
  songId: number,
): 'playing' | 'paused' | null {
  if (state.songId !== songId) return null
  return state.playing ? 'playing' : 'paused'
}

/**
 * Whether two engine states differ in anything but the clock.
 *
 * The clock — the position and the duration — goes to the progress store. Everything else (playing, volume, loop points…) is rare, and
 * is what the provider still keeps in state.
 */
export function differsBesidesClock<T extends { currentTime: number; duration: number }>(
  a: T,
  b: T,
): boolean {
  for (const key of Object.keys(b) as (keyof T)[]) {
    if (key === 'currentTime' || key === 'duration') continue
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
  const expected = last.playing
    ? last.position + ((now - last.at) / 1000) * last.rate
    : last.position
  return Math.abs(position - expected) > threshold
}
