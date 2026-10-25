import {
  audibleLevel,
  EngineHub,
  lookaheadId,
  unplayableState,
  volumeChange,
  type EngineCapabilities,
  type EngineState,
  type EngineWiring,
  type LoadOptions,
  type PlaybackEngine,
} from '@selfmp3/client'
import { noteRefusal } from './bucketRefusal'
import {
  cannotPlayYet,
  LOST_CONNECTION,
  notHere,
  streamFailureMessage,
} from './streamFailure.model'
import { clamp } from '@selfmp3/shared'
import { thisPlace } from './place'

/**
 * The web half of the `PlaybackEngine` port.
 *
 * The stream URL comes from the wiring. A song this device has nowhere to
 * play from — no copy, and neither the bucket nor a server answering here —
 * has an empty address, and is said to be unplayable as the phone's engine
 * says it, rather than thrown out of a promise nobody awaits.
 *
 * `capabilities` declares what this engine can do, so the visualiser and
 * settings need not guess.
 */

/** What a browser can do, which is all of it — known before an engine is made. */
export const engineCapabilities: EngineCapabilities = {
  crossfade: true,
  analyser: true,
}

/** How early to start preloading the next track, in seconds. */
const PRELOAD_LEAD = 20
/** How often the crossfade ramp updates. 50 ms is smooth and cheap. */
const FADE_TICK_MS = 50
/** `HTMLMediaElement.HAVE_METADATA`: the element knows the duration and can seek. */
const HAVE_METADATA = 1
/** `HTMLMediaElement.HAVE_NOTHING`: not a byte of the song has come. */
const HAVE_NOTHING = 0
/**
 * How long a song asked to play may go without a byte of it arriving before
 * that counts as a failure. A server that has frozen, or a bucket read that
 * stalls, never answers and never errors: the element waits on it forever.
 */
const START_GIVES_UP_MS = 15_000

/**
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
class AudioEngine implements PlaybackEngine {
  readonly capabilities = engineCapabilities

  /** Where to fetch a song, or null when this device has nowhere to play it from. */
  #urlFor(songId: number): string | null {
    return this.#hub.wiring.streamUrl?.(songId) || null
  }

  #primary: HTMLAudioElement
  #secondary: HTMLAudioElement

  /**
   * State, listeners and wiring, as the phone's engine keeps them
   * (`@selfmp3/client`).
   *
   * Two of the wiring's answers are little read here. `streamHeaders`: an `<audio>`
   * element sends no headers of anyone's choosing, so a bucket song's address
   * is the app's own and the service worker attaches the doorman's bearer on
   * the way out (ports/bucketMedia.web.ts). `trackMetadata`: a browser draws
   * its own now-playing UI, so there is no card for the operating system to
   * fill in; only its title is read, to name a song that cannot be played.
   */
  readonly #hub = new EngineHub()

  #crossfadeSeconds = 0

  /**
   * Song id currently loaded into the primary element — after a handover, the
   * one faded or swapped in. Null after a failure, so asking again loads it
   * afresh (`LoadOptions`).
   */
  #currentId: number | null = null
  /** Song id preloaded into the secondary element, if any. */
  #preloadedId: number | null = null
  /** Counts loads, so one overtaken by a newer load stops after its await. */
  #loadGeneration = 0
  /**
   * The load whose failure has been told. One failure is told once: the
   * element's `error` event, the rejected `play()` and the reason asked of
   * the address all come from the same failed load, and each told was taken
   * as another song failing — which restarted the run the player stops after
   * three skips.
   */
  #failedGeneration = -1
  /** Gives up on a song that never starts arriving (`START_GIVES_UP_MS`). */
  #startWatch: ReturnType<typeof setTimeout> | null = null
  /**
   * Where a song loaded to sit paused should start from once it is played.
   *
   * Such a song — the queue restored when the app opens, Next pressed while
   * paused — is not fetched until then: an `<audio>` with `preload="auto"`
   * starts streaming on `load()`, and in a browser tab every range it asks
   * for is a read from the bucket, so a tab opened only to look at the
   * library was two reads before anything played. The seek waits with it,
   * because there is no metadata to seek in until the bytes come.
   */
  #startWhenPlayed: number | null = null

  #fadeTimer: ReturnType<typeof setInterval> | null = null
  #handoverArmed = false

  /** Only exist once a visual has asked to hear the music; see `analyser()`. */
  #audioContext: AudioContext | null = null
  #analyser: AnalyserNode | null = null

  /** See `PlaybackEngine.connect`. */
  connect(wiring: Partial<EngineWiring>): () => void {
    return this.#hub.connect(wiring)
  }

  constructor() {
    this.#primary = createElement()
    this.#secondary = createElement()
    this.#attach(this.#primary)
  }

  // --- subscription --------------------------------------------------------

  subscribe(listener: (state: EngineState) => void): () => void {
    return this.#hub.subscribe(listener)
  }

  get state(): EngineState {
    return this.#hub.state
  }

  /** The song in the audio element, or null before anything has been loaded. */
  get currentSongId(): number | null {
    return this.#currentId
  }

  // --- configuration -------------------------------------------------------

  configure(options: { crossfadeSeconds: number }): void {
    this.#crossfadeSeconds = clamp(options.crossfadeSeconds, 0, 12)
  }

  // --- playback ------------------------------------------------------------

  /**
   * Load and play a song.
   *
   * The song already in the element is carried on with (`LoadOptions`) — which
   * is also how the handover a finished crossfade made is acknowledged, rather
   * than reloaded from 0:00. If the requested song is the one already
   * preloaded in the secondary element, the two elements are swapped instead
   * of reloading — which is what makes "next track" instant rather than a
   * fresh network round trip.
   */
  async load(songId: number, options: LoadOptions = {}): Promise<void> {
    const { autoplay = true } = options
    const generation = ++this.#loadGeneration
    this.#stopStartWatch()
    // Cleared before anything is awaited, so a failure of this load is a
    // change the provider hears even when it says what the last one did.
    this.#hub.patch({ error: null })

    if (songId === this.#currentId) {
      // A fade under way is into the song after this one, which is not next any more.
      this.#abortCrossfade()
      this.#handoverArmed = false
      if (options.startAt !== undefined) {
        // Not fetched yet (`#startWhenPlayed`): the position waits with it.
        if (this.#startWhenPlayed !== null) this.#startWhenPlayed = options.startAt
        else this.seek(options.startAt)
      }
      if (autoplay) await this.play()
      return
    }

    const startAt = options.startAt ?? 0
    this.#stopFade()
    this.#handoverArmed = false

    // A preload that failed has nothing to hand over, and no error event left to say so.
    if (this.#preloadedId === songId && startAt === 0 && this.#secondary.error === null) {
      this.#swap()
    } else {
      const url = this.#urlFor(songId)
      if (url === null) {
        // Nowhere to play it from. The song before it is not this one either:
        // the queue has moved on from it.
        this.#primary.pause()
        this.#currentId = null
        this.#hub.patch(
          unplayableState(
            cannotPlayYet(this.#hub.wiring.trackMetadata?.(songId)?.title, thisPlace()),
          ),
        )
        return
      }
      // Paused: nothing is fetched until play (`#startWhenPlayed`).
      this.#primary.preload = autoplay ? 'auto' : 'none'
      this.#primary.src = url
      this.#primary.load()
      this.#startWhenPlayed = null
      if (startAt > 0 && !autoplay) {
        this.#startWhenPlayed = startAt
      } else if (startAt > 0) {
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
    this.#primary.volume = audibleLevel(this.#hub.state)
    // The length too: the song before's stood under this one's title until
    // its metadata came, and the bar's fallback (the library's) never showed.
    const duration = this.#primary.duration
    this.#hub.patch({
      error: null,
      currentTime: startAt,
      duration: Number.isFinite(duration) ? duration : 0,
    })

    if (autoplay) await this.play()
  }

  async play(): Promise<void> {
    // Once the sound runs through Web Audio, a suspended context is silence.
    if (this.#audioContext?.state === 'suspended') void this.#audioContext.resume()
    // A song loaded to sit paused is fetched now, from where it was left.
    this.#primary.preload = 'auto'
    const startAt = this.#startWhenPlayed
    this.#startWhenPlayed = null
    if (startAt !== null) void this.#startFrom(startAt)
    if (this.#primary.readyState === HAVE_NOTHING) this.#watchStart()
    try {
      await this.#primary.play()
    } catch (error) {
      // Autoplay policies reject before any user gesture. That is expected and
      // is not worth showing as an error. A source that failed is the
      // element's `error` event's to tell, which it already has.
      const name = error instanceof Error ? error.name : ''
      if (name !== 'NotAllowedError' && name !== 'AbortError' && this.#primary.error === null) {
        this.#fail(error instanceof Error ? error.message : 'playback failed')
      }
    }
  }

  pause(): void {
    this.#abortCrossfade()
    this.#primary.pause()
    // Said now rather than left to the element's `pause` event: that event is
    // queued, and a load straight after — the next song, put on paused when
    // the one playing is removed — clears the element's queued events, which
    // left a Pause button over a song that was not playing.
    this.#hub.patch({ playing: false })
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
    this.#hub.patch({ currentTime: this.#primary.currentTime })
    // Seeking backwards past the handover point should re-arm it.
    this.#handoverArmed = false
  }

  setVolume(volume: number): void {
    const next = volumeChange(this.#hub.state, volume)
    this.#primary.volume = audibleLevel(next)
    this.#hub.patch(next)
  }

  setMuted(muted: boolean): void {
    this.#primary.volume = audibleLevel({ volume: this.#hub.state.volume, muted })
    this.#hub.patch({ muted })
  }

  /** Free both elements. Called when the app unmounts. */
  destroy(): void {
    this.#stopFade()
    this.#stopStartWatch()
    for (const element of [this.#primary, this.#secondary]) {
      element.pause()
      element.removeAttribute('src')
      element.load()
    }
    this.#hub.close()
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

  readonly #onPlay = (): void => this.#hub.patch({ playing: true, stalled: false })
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
    this.#hub.patch({ playing: false })
  }
  readonly #onWaiting = (): void => this.#hub.patch({ stalled: true })
  readonly #onPlaying = (): void => this.#hub.patch({ stalled: false })

  readonly #onDurationChange = (): void => {
    const duration = this.#primary.duration
    this.#hub.patch({ duration: Number.isFinite(duration) ? duration : 0 })
  }

  readonly #onError = (): void => {
    const code = this.#primary.error?.code
    if (code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
      void this.#explainSource(this.#primary.src)
      return
    }
    this.#fail(
      code === MediaError.MEDIA_ERR_NETWORK
        ? LOST_CONNECTION
        : code === MediaError.MEDIA_ERR_DECODE
          ? 'This file could not be decoded'
          : 'Could not play this song',
    )
  }

  /**
   * The song loaded as `generation` failed: told once, and not at all once a
   * newer load has the element. Asking for it again builds it afresh.
   */
  #fail(message: string, generation = this.#loadGeneration): void {
    if (generation !== this.#loadGeneration || generation === this.#failedGeneration) return
    this.#failedGeneration = generation
    this.#stopStartWatch()
    this.#currentId = null
    this.#hub.patch({ error: message, playing: false, stalled: false })
  }

  /**
   * Gives a song asked to play a while to start arriving, and then lets it go
   * as failed: the request is called off, and the provider retries, skips or
   * stops as for any failure — rather than a spinner turning forever.
   */
  #watchStart(): void {
    this.#stopStartWatch()
    const generation = this.#loadGeneration
    this.#startWatch = setTimeout(() => {
      this.#startWatch = null
      const element = this.#primary
      if (generation !== this.#loadGeneration || element.paused) return
      if (element.readyState !== HAVE_NOTHING || element.error !== null) return
      element.pause()
      element.removeAttribute('src')
      element.load()
      this.#fail(LOST_CONNECTION, generation)
    }, START_GIVES_UP_MS)
  }

  #stopStartWatch(): void {
    if (this.#startWatch === null) return
    clearTimeout(this.#startWatch)
    this.#startWatch = null
  }

  /**
   * Seek a song that has not loaded yet to where it was left.
   *
   * Set at once: with nothing loaded, the element takes the position as where
   * to start (the default playback start position), which saves the fetch
   * from the top that a seek after the fact costs. Where it is ignored
   * instead, the seek is made once the metadata is in — unless a newer load
   * has the element by then.
   *
   * A browser that fetched the metadata anyway, `preload="none"` or not
   * (Chrome does), has taken the seek already, and its `loadedmetadata` has
   * been and gone. Waiting for it ran out five seconds later and put the song
   * back to where it was restored, however far it had played since.
   */
  async #startFrom(startAt: number): Promise<void> {
    const generation = this.#loadGeneration
    this.#primary.currentTime = startAt
    if (this.#primary.readyState >= HAVE_METADATA) return
    await once(this.#primary, 'loadedmetadata', 5_000)
    if (generation !== this.#loadGeneration) return
    if (Math.abs(this.#primary.currentTime - startAt) > 1) this.#primary.currentTime = startAt
  }

  /**
   * "Not supported" is all the element says of a source it could not use,
   * whether the bucket refused the file for the day or the song was never on
   * this device. The address answers with the reason (streamFailure.model.ts);
   * one byte of it is asked for, and the answer is shown — unless the player
   * has moved on to another song meanwhile.
   */
  async #explainSource(src: string): Promise<void> {
    const generation = this.#loadGeneration
    const place = thisPlace()
    let message = notHere(place)
    try {
      const response = await fetch(src, { headers: { range: 'bytes=0-0' } })
      if (!response.ok && response.status !== 206) {
        const body = await response.text()
        message = streamFailureMessage(response.status, body, place)
        noteRefusal(body, message)
      }
    } catch {
      // No answer at all: the next song would get none either.
      message = LOST_CONNECTION
    }
    // The player may have moved on, or asked for this song again, meanwhile.
    this.#fail(message, generation)
  }

  readonly #onTimeUpdate = (): void => {
    const currentTime = this.#primary.currentTime
    const duration = Number.isFinite(this.#primary.duration) ? this.#primary.duration : 0
    this.#hub.patch({ currentTime, duration })
    this.#hub.wiring.onProgress?.(currentTime, duration)

    if (duration <= 0) return
    const remaining = duration - currentTime

    /*
     * Start fetching the next track well before it is needed, so the handover
     * has real buffered audio to work with.
     *
     * This is what gapless actually *is* here: with the next track already
     * buffered in the second element, `load()` swaps elements instead of
     * starting a fresh network request, and there is no silence between
     * tracks. Crossfade needs the same preload.
     */
    if (remaining <= PRELOAD_LEAD && this.#preloadedId === null) this.#preload()

    // Begin the crossfade, or hand over cleanly for gapless. Armed only if one
    // actually began: there is nothing to fade into with repeat-one or at the
    // end of the queue, and claiming otherwise loses the end of the track.
    if (!this.#handoverArmed && this.#crossfadeSeconds > 0 && remaining <= this.#crossfadeSeconds) {
      this.#handoverArmed = this.#startCrossfade()
    }
  }

  readonly #onEnded = (): void => {
    // With crossfade the handover has already happened, so ignore the ended
    // event from the element that faded out.
    if (this.#handoverArmed && this.#crossfadeSeconds > 0) return
    this.#hub.wiring.onTrackEnd?.()
  }

  /**
   * The order behind this song changed. A song already fetched for the
   * handover that no longer comes next is let go, so a crossfade never fades
   * into it; the one that does is fetched in its place on the next tick, if
   * its moment has come. A fade already under way into a song that is no
   * longer next is called off: left to finish, a song removed from Up next
   * faded all the way in and was then cut off for the real one.
   */
  refreshLookahead(): void {
    if (this.#preloadedId === null) return
    if ((this.#hub.wiring.nextTrackId?.() ?? null) === this.#preloadedId) return
    this.#abortCrossfade()
    this.#preloadedId = null
    this.#secondary.removeAttribute('src')
  }

  #preload(): void {
    const nextId = lookaheadId(this.#hub.wiring.nextTrackId?.() ?? null, this.#currentId)
    if (nextId === null) return
    // Nowhere to fetch it from: its own load says so when it comes up.
    const url = this.#urlFor(nextId)
    if (url === null) return

    this.#preloadedId = nextId
    // The element may have last held a song loaded to sit paused.
    this.#secondary.preload = 'auto'
    this.#secondary.src = url
    this.#secondary.volume = 0
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
      const target = audibleLevel(this.#hub.state)

      this.#primary.volume = Math.cos((t * Math.PI) / 2) * target
      this.#secondary.volume = Math.sin((t * Math.PI) / 2) * target

      if (t >= 1) {
        this.#stopFade()
        this.#swap()
        // The next track is already playing, faded all the way in: the `load()`
        // that follows this callback finds it current and carries on with it.
        this.#currentId = this.#preloadedId
        this.#preloadedId = null
        this.#handoverArmed = false
        this.#hub.wiring.onTrackEnd?.()
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
    this.#primary.volume = audibleLevel(this.#hub.state)
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
    this.#primary.volume = audibleLevel(this.#hub.state)
    // The element being promoted has been playing for a whole crossfade
    // already, so no `play` event is coming: take the truth from the element.
    this.#hub.patch({ playing: !this.#primary.paused })
  }
}

function createElement(): HTMLAudioElement {
  const element = new Audio()
  element.preload = 'auto'
  // Required for the Media Session API and for playback to survive the phone
  // screen locking.
  element.crossOrigin = 'use-credentials'
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
 * The engine this platform uses. Call sites import this and never a class, so
 * that swapping one for the other is a resolution detail rather than a change
 * anybody has to make.
 */
export function createEngine(): PlaybackEngine {
  return new AudioEngine()
}
