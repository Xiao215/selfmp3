import type {
  EngineCapabilities,
  EngineWiring,
  EngineState as PortEngineState,
  PlaybackEngine,
} from '@selfmp3/client'

/**
 * The web half of the `PlaybackEngine` port.
 *
 * The stream URL comes from the wiring, which whoever owns the queue always
 * sets; an unset `streamUrl` reaches `#urlFor` and an error nobody should ever
 * see.
 *
 * `capabilities` declares what this engine can do, so the practice panel and
 * the visualiser need not guess.
 */

/**
 * The audio engine.
 *
 * A single `<audio>` element cannot do gapless or crossfade — by the time the
 * `ended` event fires, the gap has already happened. So this class keeps two
 * elements and alternates between them: while one plays, the next track is
 * already loaded and buffered in the other, and the handover happens either
 * instantly (gapless) or as a volume ramp (crossfade).
 *
 * Everything here is imperative and framework-free on purpose. React state
 * updates are far too slow and too coarse to drive audio; the component layer
 * subscribes to changes instead.
 */

export interface EngineState {
  readonly playing: boolean
  readonly currentTime: number
  readonly duration: number
  readonly volume: number
  readonly muted: boolean
  readonly rate: number
  /** True while the browser is waiting for data. */
  readonly stalled: boolean
  readonly error: string | null
  /** Practice: keep pitch when the rate changes (`audio.preservesPitch`). */
  readonly preservesPitch: boolean
  /** Practice: A–B loop bounds in seconds; null when unset. */
  readonly loopA: number | null
  readonly loopB: number | null
  /** True during the short pause before a loop restarts. */
  readonly countingIn: boolean
}

const INITIAL_STATE: EngineState = {
  playing: false,
  currentTime: 0,
  duration: 0,
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

type Listener = (state: EngineState) => void

/** No queue owner yet: every question the engine asks goes unanswered. */
const UNWIRED: EngineWiring = {
  onTrackEnd: null,
  nextTrackId: null,
  streamUrl: null,
  streamHeaders: null,
  trackMetadata: null,
  onProgress: null,
}

/** How early to start preloading the next track, in seconds. */
const PRELOAD_LEAD = 20
/** How often the crossfade ramp updates. 50 ms is smooth and cheap. */
const FADE_TICK_MS = 50
/**
 * How often the A–B loop guard checks the playhead. `timeupdate` only fires
 * about four times a second, which would overshoot B by up to a quarter of a
 * second; a tighter interval keeps the jump back within ~30 ms.
 */
const LOOP_TICK_MS = 30
/** A loop shorter than this is a click, not a phrase. */
const MIN_LOOP_SECONDS = 0.5

class AudioEngine implements PlaybackEngine {
  /** What a browser can do, which is all of it. */
  readonly capabilities: EngineCapabilities = {
    crossfade: true,
    analyser: true,
    loop: true,
  }

  /** Where to fetch a song. Unset is a wiring mistake, not a fallback. */
  #urlFor(songId: number): string {
    const url = this.#wiring.streamUrl?.(songId)
    if (!url) {
      throw new Error(
        `no streamUrl configured; cannot play song ${songId}. ` +
          'Whoever owns the queue connects `streamUrl`.',
      )
    }
    return url
  }

  #primary: HTMLAudioElement
  #secondary: HTMLAudioElement

  #state: EngineState = INITIAL_STATE
  readonly #listeners = new Set<Listener>()

  #crossfadeSeconds = 0
  #gapless = true

  /** Song id currently loaded into the primary element. */
  #currentId: number | null = null
  /** Song id preloaded into the secondary element, if any. */
  #preloadedId: number | null = null
  /**
   * The track a finished crossfade left playing, waiting for the `load()` that
   * follows `onTrackEnd` to acknowledge it rather than reload it.
   */
  #handedOverId: number | null = null
  /** Counts loads, so one overtaken by a newer load stops after its await. */
  #loadGeneration = 0

  #fadeTimer: ReturnType<typeof setInterval> | null = null
  #handoverArmed = false

  #loopTimer: ReturnType<typeof setInterval> | null = null
  #countInTimer: ReturnType<typeof setTimeout> | null = null
  /** Milliseconds of silence before each loop restart; 0 disables it. */
  #countInMs = 0

  /** Only exist once a visual has asked to hear the music; see `analyser()`. */
  #audioContext: AudioContext | null = null
  #analyser: AnalyserNode | null = null

  /**
   * Whoever owns the queue, as handed over through `connect`.
   *
   * Two of its answers go unread here. `streamHeaders`: an `<audio>` element
   * sends no headers of anyone's choosing, so a bucket song's address is the
   * app's own and the service worker attaches the doorman's bearer on the way
   * out (ports/bucketMedia.web.ts). `trackMetadata`: a browser draws its own
   * now-playing UI, so there is no card for the operating system to fill in;
   * `navigator.mediaSession` is the obvious next reader of it.
   */
  #wiring: EngineWiring = UNWIRED

  /** See `PlaybackEngine.connect`. */
  connect(wiring: Partial<EngineWiring>): () => void {
    const previous = this.#wiring
    this.#wiring = { ...previous, ...wiring }
    return () => {
      this.#wiring = previous
    }
  }

  constructor() {
    this.#primary = createElement()
    this.#secondary = createElement()
    this.#attach(this.#primary)
  }

  // --- subscription --------------------------------------------------------

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener)
    listener(this.#state)
    return () => this.#listeners.delete(listener)
  }

  get state(): EngineState {
    return this.#state
  }

  /** The song in the audio element, or null before anything has been loaded. */
  get currentSongId(): number | null {
    return this.#currentId
  }

  #update(patch: Partial<EngineState>): void {
    // Skip the notify entirely when nothing actually changed; this runs on
    // every timeupdate tick and would otherwise re-render constantly.
    let changed = false
    for (const [key, value] of Object.entries(patch)) {
      if (this.#state[key as keyof EngineState] !== value) {
        changed = true
        break
      }
    }
    if (!changed) return

    this.#state = { ...this.#state, ...patch }
    for (const listener of this.#listeners) listener(this.#state)
  }

  // --- configuration -------------------------------------------------------

  configure(options: { crossfadeSeconds?: number; gapless?: boolean }): void {
    if (options.crossfadeSeconds !== undefined) {
      this.#crossfadeSeconds = Math.max(0, Math.min(12, options.crossfadeSeconds))
    }
    if (options.gapless !== undefined) this.#gapless = options.gapless
  }

  // --- playback ------------------------------------------------------------

  /**
   * Load and play a song.
   *
   * If the requested song is the one already preloaded in the secondary
   * element, the two elements are swapped instead of reloading — which is what
   * makes "next track" instant rather than a fresh network round trip.
   */
  async load(
    songId: number,
    options: { autoplay?: boolean; startAt?: number } = {},
  ): Promise<void> {
    const { autoplay = true, startAt = 0 } = options
    const generation = ++this.#loadGeneration
    // Cleared before anything is awaited, so a failure of this load is a
    // change the provider hears even when it says what the last one did.
    if (this.#state.error !== null) this.#update({ error: null })

    // A crossfade that just finished has already put this track on and faded
    // it in. Anything else means we really are changing tracks.
    const alreadyPlaying = this.#handedOverId === songId && startAt === 0
    this.#handedOverId = null

    this.#stopFade()
    this.#handoverArmed = false
    // A loop is a region of one particular song; it never carries over.
    this.clearLoop()

    if (alreadyPlaying) {
      // Nothing to load: reloading here is what restarts it from 0:00.
    } else if (this.#preloadedId === songId && startAt === 0) {
      this.#swap()
    } else {
      this.#primary.src = this.#urlFor(songId)
      this.#primary.load()
      if (startAt > 0) {
        // Seeking before metadata is ready is ignored, so wait for it.
        await once(this.#primary, 'loadedmetadata', 5_000)
        // A newer load has the element now: a song restored at 3:23 put that
        // position on the song the person had just clicked.
        if (generation !== this.#loadGeneration) return
        this.#primary.currentTime = startAt
      }
    }

    this.#currentId = songId
    this.#preloadedId = null
    this.#secondary.removeAttribute('src')
    this.#primary.volume = this.#state.muted ? 0 : this.#state.volume
    this.#update({
      error: null,
      currentTime: alreadyPlaying ? this.#primary.currentTime : startAt,
    })

    if (autoplay) await this.play()
  }

  async play(): Promise<void> {
    // An explicit play during a count-in skips the rest of the beat.
    this.#cancelCountIn()
    if (this.#state.countingIn) this.#update({ countingIn: false })
    // Once the sound runs through Web Audio, a suspended context is silence.
    if (this.#audioContext?.state === 'suspended') void this.#audioContext.resume()
    try {
      await this.#primary.play()
    } catch (error) {
      // Autoplay policies reject before any user gesture. That is expected and
      // is not worth showing as an error.
      const name = error instanceof Error ? error.name : ''
      if (name !== 'NotAllowedError' && name !== 'AbortError') {
        this.#update({ error: error instanceof Error ? error.message : 'playback failed' })
      }
    }
  }

  pause(): void {
    // Pausing mid count-in means "stop", not "resume after the beat".
    this.#cancelCountIn()
    if (this.#state.countingIn) this.#update({ countingIn: false })
    this.#abortCrossfade()
    this.#primary.pause()
  }

  /**
   * The playhead read straight from the element.
   *
   * `state.currentTime` moves in `timeupdate` steps, about four a second —
   * fine for a clock, visibly jerky for a lyric filling in as it is sung.
   * Animation reads this on each frame instead.
   */
  get playhead(): number {
    return this.#primary.currentTime
  }

  /**
   * A live view of the sound, for the spectrum visuals.
   *
   * Made on first request and then kept: an element routed through Web Audio
   * cannot be routed back out. Both elements feed it, so it keeps working
   * across gapless and crossfaded handovers. Callers decide where it is safe
   * to ask — never on a phone, where a locked screen suspends Web Audio and
   * would take playback down with it.
   */
  analyser(): AnalyserNode | null {
    if (this.#analyser) return this.#analyser
    const Context =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Context) return null
    try {
      const context = new Context()
      const analyser = context.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.8
      for (const element of [this.#primary, this.#secondary]) {
        context.createMediaElementSource(element).connect(analyser)
      }
      analyser.connect(context.destination)
      // A context the browser suspends (another tab took the output, say)
      // would leave the song playing in silence; wake it if music should be on.
      context.addEventListener('statechange', () => {
        if (context.state === 'suspended' && !this.#primary.paused) void context.resume()
      })
      void context.resume()
      this.#audioContext = context
      this.#analyser = analyser
      return analyser
    } catch {
      return null
    }
  }

  seek(seconds: number): void {
    this.#abortCrossfade()
    const duration = this.#primary.duration
    const target = Number.isFinite(duration) ? Math.min(seconds, duration) : seconds
    this.#primary.currentTime = Math.max(0, target)
    this.#update({ currentTime: this.#primary.currentTime })
    // Seeking backwards past the handover point should re-arm it.
    this.#handoverArmed = false
  }

  setVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume))
    this.#primary.volume = this.#state.muted ? 0 : clamped
    this.#update({ volume: clamped, muted: clamped === 0 ? this.#state.muted : false })
  }

  setMuted(muted: boolean): void {
    this.#primary.volume = muted ? 0 : this.#state.volume
    this.#update({ muted })
  }

  setRate(rate: number): void {
    const clamped = Math.max(0.5, Math.min(3, rate))
    this.#primary.playbackRate = clamped
    this.#secondary.playbackRate = clamped
    this.#update({ rate: clamped })
  }

  // --- practice ------------------------------------------------------------

  /**
   * Keep the pitch when slowing down or speeding up.
   *
   * Applied to both elements so a preloaded track already has the setting by
   * the time it is promoted. Safari spelled this `webkitPreservesPitch` for
   * years; setting both costs nothing.
   */
  setPreservesPitch(on: boolean): void {
    for (const element of [this.#primary, this.#secondary]) applyPreservesPitch(element, on)
    this.#update({ preservesPitch: on })
  }

  /**
   * Set the A–B loop. Either bound may be null while the other is being
   * chosen; the loop only runs once both are set. Bounds arriving in the
   * wrong order are swapped, and a region too short to be useful is ignored.
   */
  setLoop(a: number | null, b: number | null): void {
    let loopA = a
    let loopB = b
    if (loopA !== null && loopB !== null) {
      if (loopB < loopA) [loopA, loopB] = [loopB, loopA]
      if (loopB - loopA < MIN_LOOP_SECONDS) loopB = null
    }
    this.#update({ loopA, loopB })
    this.#syncLoopGuard()
  }

  clearLoop(): void {
    if (this.#state.loopA === null && this.#state.loopB === null && !this.#state.countingIn) return
    this.#cancelCountIn()
    this.#update({ loopA: null, loopB: null, countingIn: false })
    this.#syncLoopGuard()
  }

  /** Silence before each restart of the loop, e.g. one beat at the song's tempo. */
  setCountIn(ms: number): void {
    this.#countInMs = Math.max(0, Math.min(3000, ms))
  }

  #syncLoopGuard(): void {
    const active = this.#state.loopA !== null && this.#state.loopB !== null
    if (active && this.#loopTimer === null) {
      this.#loopTimer = setInterval(this.#loopTick, LOOP_TICK_MS)
    } else if (!active && this.#loopTimer !== null) {
      clearInterval(this.#loopTimer)
      this.#loopTimer = null
    }
  }

  /**
   * The loop guard. Runs on its own interval rather than `timeupdate` so the
   * jump back happens close to B; it survives pause (it simply has nothing
   * to do) and seeking (a seek outside the region just plays on until B).
   */
  readonly #loopTick = (): void => {
    const { loopA, loopB, countingIn } = this.#state
    if (loopA === null || loopB === null || countingIn) return
    if (this.#primary.paused) return

    const duration = this.#primary.duration
    const end = Number.isFinite(duration) && duration > 0 ? Math.min(loopB, duration - 0.05) : loopB
    if (this.#primary.currentTime < end) return

    if (this.#countInMs > 0) {
      this.#primary.pause()
      this.#primary.currentTime = loopA
      this.#update({ countingIn: true, currentTime: loopA })
      this.#countInTimer = setTimeout(() => {
        this.#countInTimer = null
        this.#update({ countingIn: false })
        void this.play()
      }, this.#countInMs)
      return
    }

    this.#primary.currentTime = loopA
    this.#update({ currentTime: loopA })
  }

  #cancelCountIn(): void {
    if (this.#countInTimer !== null) {
      clearTimeout(this.#countInTimer)
      this.#countInTimer = null
    }
  }

  /** Free both elements. Called when the app unmounts. */
  destroy(): void {
    this.#stopFade()
    this.#cancelCountIn()
    if (this.#loopTimer !== null) clearInterval(this.#loopTimer)
    this.#loopTimer = null
    for (const element of [this.#primary, this.#secondary]) {
      element.pause()
      element.removeAttribute('src')
      element.load()
    }
    this.#listeners.clear()
  }

  // --- internals -----------------------------------------------------------

  #attach(element: HTMLAudioElement): void {
    element.addEventListener('play', this.#onPlay)
    element.addEventListener('pause', this.#onPause)
    element.addEventListener('timeupdate', this.#onTimeUpdate)
    element.addEventListener('durationchange', this.#onDurationChange)
    // No `progress` listener: it published `buffered`, which nothing draws, and
    // each of its events re-rendered the player for it.
    element.addEventListener('ended', this.#onEnded)
    element.addEventListener('waiting', this.#onWaiting)
    element.addEventListener('playing', this.#onPlaying)
    element.addEventListener('error', this.#onError)
  }

  #detach(element: HTMLAudioElement): void {
    element.removeEventListener('play', this.#onPlay)
    element.removeEventListener('pause', this.#onPause)
    element.removeEventListener('timeupdate', this.#onTimeUpdate)
    element.removeEventListener('durationchange', this.#onDurationChange)
    element.removeEventListener('ended', this.#onEnded)
    element.removeEventListener('waiting', this.#onWaiting)
    element.removeEventListener('playing', this.#onPlaying)
    element.removeEventListener('error', this.#onError)
  }

  readonly #onPlay = (): void => this.#update({ playing: true, stalled: false })
  /*
   * The outgoing song running out mid-crossfade is not a pause.
   *
   * During a fade the listeners are on the element that is *ending*: it
   * reaches its own end and fires `pause` while the next song is already
   * audible. Reporting that as a pause is not put right afterwards either —
   * the incoming element starts playing before it is attached, so its `play`
   * event has already been and gone, leaving a play button over a song that is
   * playing.
   */
  readonly #onPause = (): void => {
    if (this.#fadeTimer !== null && !this.#secondary.paused) return
    this.#update({ playing: false })
  }
  readonly #onWaiting = (): void => this.#update({ stalled: true })
  readonly #onPlaying = (): void => this.#update({ stalled: false })

  readonly #onDurationChange = (): void => {
    const duration = this.#primary.duration
    this.#update({ duration: Number.isFinite(duration) ? duration : 0 })
  }

  readonly #onError = (): void => {
    const code = this.#primary.error?.code
    const message =
      code === MediaError.MEDIA_ERR_NETWORK
        ? 'Lost connection to the library'
        : code === MediaError.MEDIA_ERR_DECODE
          ? 'This file could not be decoded'
          : code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
            ? 'This song is not available offline'
            : 'Could not play this song'
    this.#update({ error: message, playing: false, stalled: false })
  }

  readonly #onTimeUpdate = (): void => {
    const currentTime = this.#primary.currentTime
    const duration = Number.isFinite(this.#primary.duration) ? this.#primary.duration : 0
    this.#update({ currentTime, duration })
    this.#wiring.onProgress?.(currentTime, duration)

    if (duration <= 0) return
    const remaining = duration - currentTime

    /*
     * Start fetching the next track well before it is needed, so the handover
     * has real buffered audio to work with.
     *
     * This is what gapless actually *is* here: with the next track already
     * buffered in the second element, `load()` swaps elements instead of
     * starting a fresh network request, and there is no silence between
     * tracks. Turning gapless off skips the preload, so each track loads on
     * demand — which costs a beat of silence but no bandwidth on songs you
     * skip past. Crossfade needs the preload regardless.
     */
    const wantsPreload = this.#gapless || this.#crossfadeSeconds > 0
    if (wantsPreload && remaining <= PRELOAD_LEAD && this.#preloadedId === null) this.#preload()

    // A loop never hands over to the next track, so no crossfade either.
    const looping = this.#state.loopA !== null && this.#state.loopB !== null
    if (looping) return

    // Begin the crossfade, or hand over cleanly for gapless. Armed only if one
    // actually began: there is nothing to fade into with repeat-one or at the
    // end of the queue, and claiming otherwise loses the end of the track.
    if (!this.#handoverArmed && this.#crossfadeSeconds > 0 && remaining <= this.#crossfadeSeconds) {
      this.#handoverArmed = this.#startCrossfade()
    }
  }

  readonly #onEnded = (): void => {
    // A loop reaching the end of the file (B at or past the duration) restarts
    // rather than moving on — the guard normally catches it first.
    if (this.#state.loopA !== null && this.#state.loopB !== null) {
      this.#primary.currentTime = this.#state.loopA
      void this.play()
      return
    }
    // With crossfade the handover has already happened, so ignore the ended
    // event from the element that faded out.
    if (this.#handoverArmed && this.#crossfadeSeconds > 0) return
    this.#wiring.onTrackEnd?.()
  }

  #preload(): void {
    const nextId = this.#wiring.nextTrackId?.() ?? null
    if (nextId === null || nextId === this.#currentId) return

    this.#preloadedId = nextId
    this.#secondary.src = this.#urlFor(nextId)
    this.#secondary.volume = 0
    this.#secondary.playbackRate = this.#state.rate
    // `preload="auto"` plus an explicit load() is what actually warms the
    // buffer; without it Safari waits until play() is called.
    this.#secondary.load()
  }

  /**
   * Ramp the outgoing element down and the incoming one up.
   *
   * Equal-power curves (sin/cos) rather than linear: a linear crossfade dips
   * audibly in the middle, because perceived loudness follows power, not
   * amplitude.
   */
  #startCrossfade(): boolean {
    if (this.#preloadedId === null) return false

    const durationMs = this.#crossfadeSeconds * 1000
    const startedAt = performance.now()

    void this.#secondary.play().catch(() => undefined)

    this.#stopFade()
    this.#fadeTimer = setInterval(() => {
      const elapsed = performance.now() - startedAt
      const t = Math.min(1, elapsed / durationMs)
      // Read on every tick, so a volume change or mute during the fade is heard.
      const target = this.#state.muted ? 0 : this.#state.volume

      this.#primary.volume = Math.cos((t * Math.PI) / 2) * target
      this.#secondary.volume = Math.sin((t * Math.PI) / 2) * target

      if (t >= 1) {
        this.#stopFade()
        this.#swap()
        this.#currentId = this.#preloadedId
        // The next track is already playing, faded all the way in. Say so, or
        // the `load()` that follows this callback reloads the element it is
        // playing from and starts it again from the beginning.
        this.#handedOverId = this.#preloadedId
        this.#preloadedId = null
        this.#handoverArmed = false
        this.#wiring.onTrackEnd?.()
      }
    }, FADE_TICK_MS)
    return true
  }

  /**
   * Call off a crossfade under way, back to the outgoing song alone.
   *
   * Pause and seek mean the song on screen, which is the outgoing one until
   * the handover. Left running, the fade went on without it: a pause stopped
   * the song fading out while the one fading in played on, and the handover
   * then made that one the song, still playing. The next song stays preloaded,
   * so the fade starts again when its moment comes back round.
   */
  #abortCrossfade(): void {
    if (this.#fadeTimer === null) return
    this.#stopFade()
    this.#secondary.pause()
    this.#secondary.currentTime = 0
    this.#secondary.volume = 0
    this.#primary.volume = this.#state.muted ? 0 : this.#state.volume
    this.#handoverArmed = false
  }

  #stopFade(): void {
    if (this.#fadeTimer !== null) {
      clearInterval(this.#fadeTimer)
      this.#fadeTimer = null
    }
  }

  /** Promote the secondary element to primary. */
  #swap(): void {
    this.#detach(this.#primary)
    this.#primary.pause()
    this.#primary.removeAttribute('src')

    const old = this.#primary
    this.#primary = this.#secondary
    this.#secondary = old

    this.#attach(this.#primary)
    this.#primary.volume = this.#state.muted ? 0 : this.#state.volume
    this.#primary.playbackRate = this.#state.rate
    applyPreservesPitch(this.#primary, this.#state.preservesPitch)
    // The element being promoted has been playing for a whole crossfade
    // already, so no `play` event is coming: take the truth from the element.
    this.#update({ playing: !this.#primary.paused })
  }
}

/** `preservesPitch` plus the prefixed spelling older Safari understands. */
function applyPreservesPitch(element: HTMLAudioElement, on: boolean): void {
  const target = element as HTMLAudioElement & { webkitPreservesPitch?: boolean }
  if ('preservesPitch' in target) target.preservesPitch = on
  if ('webkitPreservesPitch' in target) target.webkitPreservesPitch = on
}

function createElement(): HTMLAudioElement {
  const element = new Audio()
  element.preload = 'auto'
  // Required for the Media Session API and for playback to survive the phone
  // screen locking.
  element.crossOrigin = 'use-credentials'
  applyPreservesPitch(element, INITIAL_STATE.preservesPitch)
  return element
}

/** Wait for an event, with a timeout so a stalled load cannot hang forever. */
function once(target: EventTarget, event: string, timeoutMs: number): Promise<void> {
  return new Promise<void>(resolve => {
    const done = (): void => {
      clearTimeout(timer)
      target.removeEventListener(event, done)
      resolve()
    }
    const timer = setTimeout(done, timeoutMs)
    target.addEventListener(event, done, { once: true })
  })
}

/**
 * Does this engine satisfy the interface written for it? A type error here
 * means the port is wrong, not the engine.
 *
 * Asserted as a type rather than an instance: constructing one builds two
 * `<audio>` elements and attaches their listeners, and at module scope that
 * happens in every bundle that so much as mentions this file.
 */
const _conforms: PlaybackEngine = null as unknown as AudioEngine
void _conforms

/** The port's `EngineState` is this engine's, which is the other half of it. */
const _stateConforms: PortEngineState = null as unknown as AudioEngine['state']
void _stateConforms

/**
 * The engine this platform uses. Call sites import this and never a class, so
 * that swapping one for the other is a resolution detail rather than a change
 * anybody has to make.
 */
export function createEngine(): PlaybackEngine {
  return new AudioEngine()
}
