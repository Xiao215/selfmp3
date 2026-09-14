/**
 * What the operating system is told about the song: the lock screen, Control
 * Center, the Dock menu, a media key.
 *
 * A no-op on a phone. iOS's now-playing card is filled in by the native engine
 * from the `trackMetadata` the player already hands it (`ports/engine.ts`), and
 * two things writing that card would fight. The web is where this is needed:
 * `navigator.mediaSession` is a browser API with no counterpart in the engine
 * port, and in the installed app it is the whole of Now Playing in Control
 * Center and the answer to the media keys on the keyboard.
 */

/** What is playing, in the OS's vocabulary rather than this app's. */
export interface NowPlaying {
  readonly title: string
  readonly artist: string
  readonly album: string
  /** A URL the OS can fetch without a header, or null. */
  readonly artwork: string | null
  /** Seconds; 0 when the song has not said. */
  readonly duration: number
}

/** What the OS may ask for. Anything missing is not offered to it. */
export interface MediaSessionActions {
  play(): void
  pause(): void
  next(): void
  previous(): void
  /** Absolute, in seconds: the scrubber in Control Center. */
  seekTo(seconds: number): void
  /** Relative: the 15-second buttons some keyboards and headsets send. */
  seekBy(delta: number): void
}

export interface MediaSessionPort {
  /** False where nothing is listening, so a caller can skip the work. */
  readonly available: boolean
  setActions(actions: MediaSessionActions | null): void
  setNowPlaying(now: NowPlaying | null): void
  setPlaying(playing: boolean): void
  setPosition(position: number, duration: number, rate: number): void
}

export const mediaSession: MediaSessionPort = {
  available: false,
  setActions: () => {},
  setNowPlaying: () => {},
  setPlaying: () => {},
  setPosition: () => {},
}
