/**
 * `PlaybackEngine` — what makes a sound, on whichever device this is.
 *
 * Two implementations, neither of which belongs in this package: the browser's
 * is two `<audio>` elements with a Web Audio analyser and a crossfade, and the
 * phone's is react-native-track-player driving a native queue and the lock
 * screen. This is the surface `PlayerProvider` is written against so there is
 * one of it rather than the two that exist today.
 *
 * Derived from `apps/web/src/player/engine.ts` rather than designed fresh. That
 * engine has years of real behaviour in it — gapless handover, crossfade,
 * count-in, an A/B loop — and inventing a tidier shape here would mean
 * discovering at integration time which parts of it the shape could not
 * express. Its state object was already free of DOM types; only `analyser()`
 * was not, and that is handled below.
 */

/** Everything a screen can ask about what is currently sounding. */
export interface EngineState {
  readonly playing: boolean
  readonly currentTime: number
  readonly duration: number
  /** How far ahead the buffer reaches, in seconds. */
  readonly buffered: number
  readonly volume: number
  readonly muted: boolean
  readonly rate: number
  /** Waiting on the network mid-song, which the UI shows differently to paused. */
  readonly stalled: boolean
  readonly error: string | null
  readonly preservesPitch: boolean
  readonly loopA: number | null
  readonly loopB: number | null
  readonly countingIn: boolean
}

/**
 * As much of an `AnalyserNode` as the visualiser actually reads, and no more.
 *
 * The same structural trick `platform.ts` uses for `fetch`: this package
 * compiles without the DOM and cannot name `AnalyserNode`, but a real one
 * satisfies this by being itself. Naming two members rather than the whole node
 * also says plainly how small the dependency is — a native implementation that
 * ever wants a visualiser has two functions to provide, not a Web Audio graph.
 */
export interface FrequencyAnalyser {
  readonly frequencyBinCount: number
  getByteFrequencyData(into: Uint8Array): void
}

/**
 * What this engine can actually do.
 *
 * Read by the practice panel, the visualiser and the settings page: a control
 * for something the platform cannot do is not rendered, and settings says why,
 * the way the phone's About section does for crossfade today. Declaring them
 * beats feature-detection at each call site, which is how one platform ends up
 * silently missing a control nobody noticed it could have.
 */
export interface EngineCapabilities {
  /** Overlap two songs. The browser can; track-player cannot. */
  readonly crossfade: boolean
  /** Drive a live visualiser — `analyser()` returns null without this. */
  readonly analyser: boolean
  /** Change speed without changing pitch. */
  readonly pitchLock: boolean
  /** Put metadata and transport controls on the lock screen or in the car. */
  readonly lockScreen: boolean
  /** The platform owns the queue, so handing it songs ahead is its job. */
  readonly nativeQueue: boolean
}

export interface LoadOptions {
  /** Default true. False loads a song ready to play without starting it. */
  readonly autoplay?: boolean
  /** Seconds in to begin, for resuming where you left off. */
  readonly startAt?: number
}

export interface PlaybackEngine {
  readonly capabilities: EngineCapabilities

  readonly state: EngineState
  readonly currentSongId: number | null
  /**
   * The playhead, read directly rather than from `state`.
   *
   * `state.currentTime` updates on a timer, which is often enough to draw a
   * progress bar and not nearly enough to place a practice loop point. This
   * asks the engine where it is right now.
   */
  readonly playhead: number

  subscribe(listener: (state: EngineState) => void): () => void

  configure(options: { crossfadeSeconds?: number; gapless?: boolean }): void

  load(songId: number, options?: LoadOptions): Promise<void>
  play(): Promise<void>
  pause(): void
  seek(seconds: number): void

  setVolume(volume: number): void
  setMuted(muted: boolean): void
  setRate(rate: number): void
  setPreservesPitch(on: boolean): void

  /** The practice loop. Both null clears it, as does loading another song. */
  setLoop(a: number | null, b: number | null): void
  clearLoop(): void
  /** Milliseconds of click before the loop restarts; 0 turns it off. */
  setCountIn(ms: number): void

  /** Null where `capabilities.analyser` is false. */
  analyser(): FrequencyAnalyser | null

  destroy(): void

  /*
   * Wiring, set by whoever owns the queue.
   *
   * Properties rather than constructor arguments because the engine outlives
   * any particular queue: the provider re-points these as the queue changes,
   * and an engine built around one of them would have to be rebuilt instead —
   * which on the web means dropping the `<audio>` element that is playing.
   */

  /** Called when a song finishes on its own, so the queue can advance. */
  onTrackEnd: (() => void) | null
  /** What to preload, for gapless and crossfade. Null means nothing follows. */
  nextTrackId: (() => number | null) | null
  /** Where to fetch a song. Null falls back to the engine's own default. */
  streamUrl: ((songId: number) => string) | null
  /** Every progress tick, for counting a play. */
  onProgress: ((currentTime: number, duration: number) => void) | null
}
