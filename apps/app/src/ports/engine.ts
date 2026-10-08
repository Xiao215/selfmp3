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
import { askWhyRefused } from './bucketRefusal'

/**
 * The phone's engine: react-native-track-player behind `PlaybackEngine`.
 *
 * This is the base file and `engine.web.ts` overrides it in a browser, which
 * is the same shape the other ports here take (`secrets`, `prefs`,
 * `keyboard`). Metro picks the web one for a web bundle, so track-player never
 * reaches it; nor does anything else in a browser's bundle
 * (`player/registerPlayback.web.ts`, `ports/car/CarProvider.tsx`).
 *
 * **The question this file answers.** The port hands an engine one song at a
 * time and a hint about what follows; track-player owns a queue and advances
 * through it by itself. Those are two different ideas of who is in charge, and
 * this port has to decide between them.
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
}

const IDLE: EngineState = {
  playing: false,
  currentTime: 0,
  duration: 0,
  volume: 1,
  muted: false,
  stalled: false,
  error: null,
}

/** No queue owner yet: every question the engine asks goes unanswered. */
const UNWIRED: EngineWiring = {
  onTrackEnd: null,
  nextTrackId: null,
  streamUrl: null,
  streamHeaders: null,
  trackMetadata: null,
  onProgress: null,
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

/** Everything the Now Playing card shows of a song, as one string to compare. */
function cardKey(meta: TrackMetadata): string {
  return [
    meta.title,
    meta.artist ?? '',
    meta.album ?? '',
    meta.artwork ?? '',
    meta.duration ?? 0,
  ].join('\u0000')
}

class NativeEngine implements PlaybackEngine {
  readonly capabilities = capabilities

  #state: EngineState = IDLE
  #listeners = new Set<(state: EngineState) => void>()
  #subscriptions: { remove: () => void }[] = []
  #currentSongId: number | null = null
  /** What we last handed the player as the song after this one, and where it was to come from. */
  #queuedNext: { readonly id: number; readonly url: string } | null = null
  /** Set while `load` is driving the player, so its own changes are not "ended". */
  #loading = false
  /** Counts loads, so one overtaken by a newer load stops at its next await. */
  #loadGeneration = 0
  #destroyed = false
  /** What each song handed to the player was shown as on the card (`cardKey`), so an unchanged one is not sent again. */
  #cardShown = new Map<number, string>()
  #volume = 1
  #muted = false
  /** Whoever owns the queue, as handed over through `connect`. */
  #wiring: EngineWiring = UNWIRED

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
    // which is fine for telling whether Previous restarts the song; the
    // visual runs its own clock between ticks (`PlayheadClock`).
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
    // another. Every step below awaits, and a load allowed to carry on past a
    // newer one resets the player back to its own song, or puts its start
    // position on the song the person just picked.
    const generation = ++this.#loadGeneration
    const overtaken = (): boolean => generation !== this.#loadGeneration
    // Cleared before anything is awaited, so a failure of this load is a
    // change the provider hears even when it says what the last one did.
    this.#patch({ error: null })
    await ensurePlayer()
    if (this.#destroyed || overtaken()) return

    // Already the song that is sounding. This is the ordinary case right after
    // the player advanced by itself and the provider agreed with it, and
    // reloading here is what would turn a gapless join into a stutter. The
    // player used up the song lent behind this one to get here, so lend the
    // next: without it the join after this song is a gap, and Next on the lock
    // screen has nowhere to go.
    if (this.#currentSongId === songId) {
      if (startAt !== undefined) await TrackPlayer.seekTo(startAt)
      if (overtaken()) return
      if (autoplay) await TrackPlayer.play()
      if (overtaken()) return
      // It was lent as the next song, so the card has what it was lent with:
      // a cover kept since then is not on it yet.
      await this.#refreshNowPlaying(songId)
      if (overtaken()) return
      await this.#topUpLookahead()
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
      if (this.#queuedNext?.id === songId) {
        await TrackPlayer.skipToNext()
      } else {
        await TrackPlayer.reset()
        if (overtaken()) return
        await TrackPlayer.add(track)
      }
      if (overtaken()) return

      this.#currentSongId = songId
      this.#queuedNext = null
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
    // A cover that arrived while this load was awaiting went nowhere.
    await this.#refreshNowPlaying(songId)
    if (overtaken()) return
    await this.#topUpLookahead()
  }

  /**
   * Tell the lock screen and Control Center again what the sounding song is,
   * if what they were handed has changed since: a cover kept after the song
   * started — a bucket cover is fetched while it plays — or a title edited
   * meanwhile. The provider calls this when either changes; nothing in the
   * engine hears of a cover arriving.
   */
  refreshNowPlaying(songId: number): void {
    void this.#refreshNowPlaying(songId)
  }

  async #refreshNowPlaying(songId: number): Promise<void> {
    if (this.#destroyed || this.#loading || this.#currentSongId !== songId) return
    const meta = this.#wiring.trackMetadata?.(songId)
    if (!meta) return
    const key = cardKey(meta)
    if (this.#cardShown.get(songId) === key) return
    try {
      const [index, active] = await Promise.all([
        TrackPlayer.getActiveTrackIndex(),
        TrackPlayer.getActiveTrack(),
      ])
      // A load may have started meanwhile: never write this song onto another's card.
      if (index === undefined || songIdOf(active) !== songId) return
      if (this.#loading || this.#currentSongId !== songId) return
      await TrackPlayer.updateMetadataForTrack(index, {
        title: meta.title,
        ...(meta.artist ? { artist: meta.artist } : {}),
        ...(meta.album ? { album: meta.album } : {}),
        // Left out, the card's picture is cleared, not kept from the last song.
        ...(meta.artwork ? { artwork: meta.artwork } : {}),
        ...(meta.duration ? { duration: meta.duration } : {}),
      })
      this.#cardShown.set(songId, key)
    } catch {
      // The card keeps what it had; the next change to the song tries again.
    }
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
    const previous = this.#wiring
    this.#wiring = { ...previous, ...wiring }
    return () => {
      this.#wiring = previous
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
        this.#wiring.onProgress?.(position, duration)
      }),
    )

    this.#subscriptions.push(
      TrackPlayer.addEventListener(Event.PlaybackError, ({ message }) => {
        // A failed item stays failed in the player: loading the same song again
        // has to build it afresh, not recognise it as the one already sounding.
        const failed = this.#currentSongId
        this.#currentSongId = null
        this.#queuedNext = null
        void this.#explainFailure(failed, message ?? 'playback failed')
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
        this.#queuedNext = null
        this.#wiring.onTrackEnd?.()
      }),
    )

    this.#subscriptions.push(
      TrackPlayer.addEventListener(Event.PlaybackQueueEnded, () => {
        if (this.#loading) return
        // Nothing was lent, so the song simply ran out.
        this.#wiring.onTrackEnd?.()
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
    const nextId = this.#wiring.nextTrackId?.() ?? null
    // The same song from the same place is left alone. From somewhere new —
    // a copy kept on the disk since it was lent as a stream — it is lent
    // again, so it plays from the file.
    const url = nextId === null ? null : (this.#wiring.streamUrl?.(nextId) ?? null)
    if (nextId === (this.#queuedNext?.id ?? null) && url === (this.#queuedNext?.url ?? null)) return

    try {
      await TrackPlayer.removeUpcomingTracks()
      this.#queuedNext = null
      if (nextId === null) return
      const track = this.#trackFor(nextId)
      if (!track) return
      await TrackPlayer.add(track)
      this.#queuedNext = { id: nextId, url: track.url }
    } catch {
      // A lookahead that cannot be built is not worth failing playback over;
      // the song that is sounding is unaffected and the next `load` rebuilds.
      this.#queuedNext = null
    }
  }

  /** Ask the lookahead to be rebuilt — the provider calls this when order changes. */
  refreshLookahead(): void {
    void this.#topUpLookahead()
  }

  /**
   * Why a song from the bucket would not play, asked before the failure is
   * told: the player says only that it failed, the same for a bucket past its
   * day's allowance, a doorman that is down, and a file that is not there.
   * The doorman is asked (`askWhyRefused`), and a refusal for the day is held
   * for the whole app, so the songs lined up next that are not on this phone
   * are passed over for the ones that are (2026-10-08). The web engine asks
   * the same way (`#explainSource`).
   */
  async #explainFailure(songId: number | null, said: string): Promise<void> {
    const url = songId === null ? null : (this.#wiring.streamUrl?.(songId) ?? null)
    const headers = songId === null ? null : (this.#wiring.streamHeaders?.(songId) ?? null)
    // Only an address behind the doorman: a file here has nothing to ask.
    const why = url && headers && /^https?:/.test(url) ? await askWhyRefused(url, headers) : null
    // Another song was loaded while this was asked: its own state stands.
    if (this.#destroyed || this.#currentSongId !== null) return
    this.#patch({ error: why ?? said })
  }

  #trackFor(songId: number): SongTrack | null {
    const url = this.#wiring.streamUrl?.(songId)
    if (!url) return null
    const meta = this.#wiring.trackMetadata?.(songId) ?? null
    if (meta) this.#cardShown.set(songId, cardKey(meta))
    // The player sends these with every request it makes for the track, ranges
    // included — which is what lets a bucket song stream from behind the
    // doorman instead of having to be on the disk first.
    const headers = this.#wiring.streamHeaders?.(songId) ?? null
    return {
      songId,
      id: String(songId),
      url,
      ...(headers ? { headers: { ...headers } } : {}),
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
 * The engine this platform uses. Call sites import this and never a class, so
 * that swapping one for the other is a resolution detail rather than a change
 * anybody has to make.
 */
export function createEngine(): PlaybackEngine {
  return new NativeEngine()
}
