/**
 * `PlaybackEngine` — what makes a sound, on whichever device this is.
 *
 * Two implementations, neither of which belongs in this package: the browser's
 * is two `<audio>` elements with a Web Audio analyser and a crossfade, and the
 * phone's is react-native-track-player driving a native queue and the lock
 * screen. This is the surface `PlayerProvider` is written against so there is
 * one of it rather than the two that exist today.
 *
 * Derived from years of real behaviour — gapless handover, crossfade,
 * count-in, an A/B loop — rather than designed fresh: inventing a tidier shape
 * here would mean discovering at integration time which parts of that
 * behaviour the shape could not express. The state object was already free of
 * DOM types; only `analyser()` was not, and that is handled below.
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
  /** Loop A to B to within a frame, with a count-in before each restart. */
  readonly loop: boolean
  /** Put metadata and transport controls on the lock screen or in the car. */
  readonly lockScreen: boolean
  /** The platform owns the queue, so handing it songs ahead is its job. */
  readonly nativeQueue: boolean
}

/**
 * What the lock screen, the car and the notification shade show.
 *
 * The port hands the engine a song id and a URL, which is all a browser needs:
 * an `<audio>` element plays a URL and the page draws everything else. A phone
 * does not work that way. The operating system draws the now-playing card
 * itself, from metadata given to the player alongside the URL, and an engine
 * that only knows an id would put a blank card on the lock screen.
 *
 * So the queue's owner supplies this the same way it supplies `streamUrl`.
 * Everything is optional except the title, because everything else genuinely
 * can be missing — a song with no album art is common and a card without it is
 * fine, whereas a card with no title is a bug.
 */
export interface TrackMetadata {
  readonly title: string
  readonly artist?: string
  readonly album?: string
  /** Absolute URL. Omitted where there is none, or none the player may fetch. */
  readonly artwork?: string
  readonly duration?: number
  /** MIME type, where the platform wants a hint. */
  readonly contentType?: string
}

export interface LoadOptions {
  /** Default true. False loads a song ready to play without starting it. */
  readonly autoplay?: boolean
  /** Seconds in to begin, for resuming where you left off. */
  readonly startAt?: number
}

/** What an engine needs from whoever owns the queue. */
export interface EngineWiring {
  /** Called when a song finishes on its own, so the queue can advance. */
  onTrackEnd: (() => void) | null
  /** What to preload, for gapless and crossfade. Null means nothing follows. */
  nextTrackId: (() => number | null) | null
  /** Where to fetch a song. Null falls back to the engine's own default. */
  streamUrl: ((songId: number) => string) | null
  /** What has to ride with the request for it; see `PlaybackEngine.streamHeaders`. */
  streamHeaders: ((songId: number) => Readonly<Record<string, string>> | null) | null
  /** What to show where the platform draws the now-playing card. */
  trackMetadata: ((songId: number) => TrackMetadata | null) | null
  /** Every progress tick, for counting a play. */
  onProgress: ((currentTime: number, duration: number) => void) | null
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

  /**
   * Point the engine at whoever owns the queue.
   *
   * A method rather than four assignable properties, and not only for tidiness:
   * a provider that assigns to an engine it created during render is mutating
   * render-owned state, which the React Compiler stops — rightly, since the
   * thing being mutated looks to it like a value React manages. Handing the
   * wiring over in one call says what is really happening: the engine outlives
   * every render and is being told where to ask.
   *
   * Returns the undo, so an effect can clean up after itself. Fields left out
   * are unchanged; passing null for one clears it.
   */
  connect(wiring: Partial<EngineWiring>): () => void

  /*
   * The wiring itself, readable and assignable for an engine's own use. A
   * provider should call `connect` rather than touch these.
   */

  /** Called when a song finishes on its own, so the queue can advance. */
  onTrackEnd: (() => void) | null
  /** What to preload, for gapless and crossfade. Null means nothing follows. */
  nextTrackId: (() => number | null) | null
  /** Where to fetch a song. Null falls back to the engine's own default. */
  streamUrl: ((songId: number) => string) | null
  /**
   * The headers a song's request has to carry, or null when it needs none.
   *
   * For the one address that is no use bare: a bucket song, behind a doorman
   * that reads a bearer header and nothing else. Only an engine that can send
   * headers reads this — a phone's player takes them with each track. A
   * browser's `<audio>` element cannot, which is why its bucket addresses are
   * the app's own and a service worker signs for them; that engine never asks.
   */
  streamHeaders: ((songId: number) => Readonly<Record<string, string>> | null) | null
  /**
   * What to show for a song where the platform draws the now-playing card.
   * Null, or a null answer, means the engine shows what it can work out.
   */
  trackMetadata: ((songId: number) => TrackMetadata | null) | null
  /** Every progress tick, for counting a play. */
  onProgress: ((currentTime: number, duration: number) => void) | null
}
