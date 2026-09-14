import TrackPlayer, { Event, State, type Track } from 'react-native-track-player'
import type {
  EngineCapabilities,
  EngineWiring,
  EngineState,
  FrequencyAnalyser,
  LoadOptions,
  PlaybackEngine,
  TrackMetadata,
} from '@selfmp3/client'

import { ensurePlayer } from '../player/setup'

/**
 * The phone's engine: react-native-track-player behind `PlaybackEngine`.
 *
 * This is the base file and `engine.web.ts` overrides it in a browser, which
 * is the same shape the other ports here take (`secrets`, `prefs`,
 * `keyboard`). Metro picks the web one for a web bundle, so track-player never
 * reaches it — which is what will let the stub in `metro.config.js` go.
 *
 * **The question this file answers.** The port hands an engine one song at a
 * time and a hint about what follows; track-player owns a queue and advances
 * through it by itself. Those are two different ideas of who is in charge, and
 * phase 3 could not be finished without deciding between them.
 *
 * The answer is that neither owns it outright: **the provider owns the order,
 * and the player is lent a window onto it** — the song that is sounding, and
 * the one after it. Nothing further.
 *
 * That window is not a detail. It is what makes the handover between two songs
 * gapless, because the next file is already open and buffered when the first
 * ends; and it is what makes the lock screen's Next button work, because the
 * operating system will only offer one when the player it is talking to has
 * something queued. A player handed one song at a time has neither, and a
 * player handed the whole queue becomes a second opinion about what is playing
 * — which is the bug `PlayerProvider` warns about in its own header.
 *
 * So: `load()` puts a song in front, `nextTrackId()` keeps exactly one behind
 * it, and when the player advances on its own the engine reports that as
 * `onTrackEnd` and lets the provider decide what actually comes next. If the
 * provider agrees with what already started, `load()` recognises the song is
 * playing and leaves it alone rather than starting it again — which is the
 * difference between a gapless join and an audible stutter every time a song
 * ends.
 */

const capabilities: EngineCapabilities = {
  // Two files cannot overlap in one native player. The settings screen says so.
  crossfade: false,
  // No Web Audio graph to tap; the visualiser stays a browser thing.
  analyser: false,
  // iOS preserves pitch when the rate changes; Android's player does not.
  // Declared from the platform the port is compiled for, not asked at runtime.
  pitchLock: true,
  // Progress arrives once a second from track-player, so a loop would land up to
  // a second past B. Not offered rather than offered badly.
  loop: false,
  lockScreen: true,
  nativeQueue: true,
}

const IDLE: EngineState = {
  playing: false,
  currentTime: 0,
  duration: 0,
  buffered: 0,
  volume: 1,
  muted: false,
  rate: 1,
  stalled: false,
  error: null,
  preservesPitch: true,
  loopA: null,
  loopB: null,
  countingIn: false,
}

/** A Track that remembers which song it came from. */
interface SongTrack extends Track {
  readonly songId: number
}

function songIdOf(track: Track | undefined | null): number | null {
  if (!track) return null
  const raw: unknown = track['songId']
  return typeof raw === 'number' ? raw : null
}

export class NativeEngine implements PlaybackEngine {
  readonly capabilities = capabilities

  #state: EngineState = IDLE
  #listeners = new Set<(state: EngineState) => void>()
  #subscriptions: { remove: () => void }[] = []
  #currentSongId: number | null = null
  /** What we last handed the player as the song after this one. */
  #queuedNextId: number | null = null
  /** Set while `load` is driving the player, so its own changes are not "ended". */
  #loading = false
  /** Counts loads, so one overtaken by a newer load stops at its next await. */
  #loadGeneration = 0
  #destroyed = false
  #volume = 1
  #muted = false
  #rate = 1

  onTrackEnd: (() => void) | null = null
  nextTrackId: (() => number | null) | null = null
  streamUrl: ((songId: number) => string) | null = null
  trackMetadata: ((songId: number) => TrackMetadata | null) | null = null
  onProgress: ((currentTime: number, duration: number) => void) | null = null

  constructor() {
    void this.#wire()
  }

  get state(): EngineState {
    return this.#state
  }

  get currentSongId(): number | null {
    return this.#currentSongId
  }

  get playhead(): number {
    // The port wants this synchronously and track-player only answers with a
    // promise, so the freshest tick stands in. Progress fires every second,
    // which is coarse for placing a practice loop — and the practice panel is
    // a desktop surface, where the engine is the web one.
    return this.#state.currentTime
  }

  subscribe(listener: (state: EngineState) => void): () => void {
    this.#listeners.add(listener)
    listener(this.#state)
    return () => this.#listeners.delete(listener)
  }

  configure(): void {
    // Crossfade and gapless are the player's own business here: it is already
    // gapless within its queue, and it cannot crossfade at all.
  }

  async load(songId: number, options: LoadOptions = {}): Promise<void> {
    const { autoplay = true, startAt } = options
    // Loads overlap: the app opening restores a song while a tap starts
    // another. Every step below awaits, and a load that carried on past a newer
    // one used to reset the player back to its own song, or put its start
    // position on the song the person had just picked.
    const generation = ++this.#loadGeneration
    const overtaken = (): boolean => generation !== this.#loadGeneration
    await ensurePlayer()
    if (this.#destroyed || overtaken()) return

    // Already the song that is sounding. This is the ordinary case right after
    // the player advanced by itself and the provider agreed with it, and
    // reloading here is what would turn a gapless join into a stutter.
    if (this.#currentSongId === songId) {
      if (startAt !== undefined) await TrackPlayer.seekTo(startAt)
      if (overtaken()) return
      if (autoplay) await TrackPlayer.play()
      return
    }

    this.#loading = true
    try {
      const track = this.#trackFor(songId)
      if (!track) {
        this.#patch({ error: `Song ${songId} cannot be played from this device yet.` })
        return
      }

      // The song we already queued behind this one: skip to it rather than
      // rebuild, which keeps whatever it has buffered.
      if (this.#queuedNextId === songId) {
        await TrackPlayer.skipToNext()
      } else {
        await TrackPlayer.reset()
        if (overtaken()) return
        await TrackPlayer.add(track)
      }
      if (overtaken()) return

      this.#currentSongId = songId
      this.#queuedNextId = null
      if (startAt !== undefined && startAt > 0) await TrackPlayer.seekTo(startAt)
      if (overtaken()) return
      if (autoplay) await TrackPlayer.play()
      this.#patch({ error: null })
    } catch (error) {
      if (!overtaken()) {
        this.#patch({ error: error instanceof Error ? error.message : 'could not play that song' })
      }
    } finally {
      if (!overtaken()) this.#loading = false
    }
    if (overtaken()) return
    await this.#topUpLookahead()
  }

  async play(): Promise<void> {
    await ensurePlayer()
    await TrackPlayer.play()
  }

  pause(): void {
    void TrackPlayer.pause()
  }

  seek(seconds: number): void {
    void TrackPlayer.seekTo(seconds)
  }

  setVolume(volume: number): void {
    this.#volume = volume
    void TrackPlayer.setVolume(this.#muted ? 0 : volume)
    this.#patch({ volume })
  }

  setMuted(muted: boolean): void {
    this.#muted = muted
    void TrackPlayer.setVolume(muted ? 0 : this.#volume)
    this.#patch({ muted })
  }

  setRate(rate: number): void {
    this.#rate = rate
    void TrackPlayer.setRate(rate)
    this.#patch({ rate })
  }

  setPreservesPitch(): void {
    // iOS decides this per track through `pitchAlgorithm`, and Android cannot
    // do it at all. Declared in `capabilities.pitchLock` rather than toggled.
  }

  setLoop(): void {
    // The A–B loop is the practice panel's, which is a desktop surface. Left
    // unimplemented rather than half-implemented: a loop that drifts by a
    // second is worse than one the screen does not offer.
  }

  clearLoop(): void {}

  setCountIn(): void {}

  analyser(): FrequencyAnalyser | null {
    return null
  }

  destroy(): void {
    this.#destroyed = true
    for (const subscription of this.#subscriptions) subscription.remove()
    this.#subscriptions = []
    this.#listeners.clear()
    void TrackPlayer.reset()
  }

  /** See `PlaybackEngine.connect`. */
  connect(wiring: Partial<EngineWiring>): () => void {
    const previous: Partial<EngineWiring> = {
      onTrackEnd: this.onTrackEnd,
      nextTrackId: this.nextTrackId,
      streamUrl: this.streamUrl,
      trackMetadata: this.trackMetadata,
      onProgress: this.onProgress,
    }
    Object.assign(this, wiring)
    return () => {
      Object.assign(this, previous)
    }
  }

  // --- the player's side -----------------------------------------------------

  async #wire(): Promise<void> {
    await ensurePlayer()
    if (this.#destroyed) return

    this.#subscriptions.push(
      TrackPlayer.addEventListener(Event.PlaybackState, ({ state }) => {
        this.#patch({
          playing: state === State.Playing,
          stalled: state === State.Loading || state === State.Buffering,
        })
      }),
    )

    this.#subscriptions.push(
      TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, ({ position, duration }) => {
        this.#patch({ currentTime: position, duration })
        this.onProgress?.(position, duration)
      }),
    )

    this.#subscriptions.push(
      TrackPlayer.addEventListener(Event.PlaybackError, ({ message }) => {
        this.#patch({ error: message ?? 'playback failed' })
      }),
    )

    this.#subscriptions.push(
      TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, ({ track }) => {
        // Our own `load` moving the player is not a song ending.
        if (this.#loading) return
        const songId = songIdOf(track)
        if (songId === null || songId === this.#currentSongId) return
        // The player reached the song we lent it, which means the one before
        // finished on its own. The provider decides what is actually next; it
        // usually agrees, and `load` then recognises this song and leaves it be.
        this.#currentSongId = songId
        this.#queuedNextId = null
        this.onTrackEnd?.()
      }),
    )

    this.#subscriptions.push(
      TrackPlayer.addEventListener(Event.PlaybackQueueEnded, () => {
        if (this.#loading) return
        // Nothing was lent, so the song simply ran out.
        this.onTrackEnd?.()
      }),
    )
  }

  /**
   * Keep exactly one song behind the current one.
   *
   * One, not several: the queue can be reordered, shuffled or added to between
   * now and then, and every song lent beyond the next is one the player might
   * have to be talked out of.
   */
  async #topUpLookahead(): Promise<void> {
    if (this.#destroyed) return
    const nextId = this.nextTrackId?.() ?? null
    if (nextId === this.#queuedNextId) return

    try {
      await TrackPlayer.removeUpcomingTracks()
      this.#queuedNextId = null
      if (nextId === null) return
      const track = this.#trackFor(nextId)
      if (!track) return
      await TrackPlayer.add(track)
      this.#queuedNextId = nextId
    } catch {
      // A lookahead that cannot be built is not worth failing playback over;
      // the song that is sounding is unaffected and the next `load` rebuilds.
      this.#queuedNextId = null
    }
  }

  /** Ask the lookahead to be rebuilt — the provider calls this when order changes. */
  refreshLookahead(): void {
    void this.#topUpLookahead()
  }

  #trackFor(songId: number): SongTrack | null {
    const url = this.streamUrl?.(songId)
    if (!url) return null
    const meta = this.trackMetadata?.(songId) ?? null
    return {
      songId,
      id: String(songId),
      url,
      title: meta?.title ?? 'Unknown',
      ...(meta?.artist ? { artist: meta.artist } : {}),
      ...(meta?.album ? { album: meta.album } : {}),
      ...(meta?.artwork ? { artwork: meta.artwork } : {}),
      ...(meta?.duration ? { duration: meta.duration } : {}),
      ...(meta?.contentType ? { contentType: meta.contentType } : {}),
      isLiveStream: false,
    }
  }

  #patch(change: Partial<EngineState>): void {
    // The web engine's rule: nothing changed, nobody told. Progress arrives
    // every second and PlaybackState repeats itself, and each notify is a
    // render of the provider.
    let changed = false
    for (const [key, value] of Object.entries(change)) {
      if (this.#state[key as keyof EngineState] !== value) {
        changed = true
        break
      }
    }
    if (!changed) return
    this.#state = { ...this.#state, ...change }
    for (const listener of this.#listeners) listener(this.#state)
  }
}

/**
 * The same conformance proof the web half carries, as a type rather than an
 * instance: constructing one here would set a real player up at import time.
 */
const _conforms: PlaybackEngine = null as unknown as NativeEngine
void _conforms

/**
 * The engine this platform uses. Call sites import this and never a class, so
 * that swapping one for the other is a resolution detail rather than a change
 * anybody has to make.
 */
export function createEngine(): PlaybackEngine {
  return new NativeEngine()
}
