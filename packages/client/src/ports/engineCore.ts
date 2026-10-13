import { clamp01 } from '@selfmp3/shared'

import type { EngineState, EngineWiring } from './engine.js'

/**
 * What both engines do the same way, whatever makes the sound.
 *
 * The phone's engine (track-player) and the browser's (two `<audio>`
 * elements) had each written their own state, listeners and wiring, and the
 * rules on top of them drifted: the browser learned that moving the level
 * unmutes a week before the phone did, and that a song with nowhere to play
 * from has to stop the one before it, which the phone never learned. The
 * bookkeeping and those rules live here once; an engine keeps only what its
 * platform makes it do.
 */

/** Nothing loaded, at full level. */
const IDLE_ENGINE_STATE: EngineState = {
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

/**
 * An engine's state, who is listening to it, and who it answers to.
 *
 * Held by each engine as a private member rather than inherited: an engine's
 * own fields stay private to it, and this is the whole of what is shared.
 */
export class EngineHub {
  #state: EngineState = IDLE_ENGINE_STATE
  readonly #listeners = new Set<(state: EngineState) => void>()
  #wiring: EngineWiring = UNWIRED

  get state(): EngineState {
    return this.#state
  }

  /** Whoever owns the queue, as handed over through `connect`. */
  get wiring(): EngineWiring {
    return this.#wiring
  }

  subscribe(listener: (state: EngineState) => void): () => void {
    this.#listeners.add(listener)
    listener(this.#state)
    return () => this.#listeners.delete(listener)
  }

  /**
   * Nothing changed, nobody told. Progress arrives every tick and a player
   * repeats its own state, and each notify is a render of the provider.
   */
  patch(change: Partial<EngineState>): void {
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

  /** See `PlaybackEngine.connect`. */
  connect(wiring: Partial<EngineWiring>): () => void {
    const previous = this.#wiring
    this.#wiring = { ...previous, ...wiring }
    return () => {
      this.#wiring = previous
    }
  }

  /** Destroyed: nobody is told anything again. */
  close(): void {
    this.#listeners.clear()
  }
}

/**
 * A new level, and whether that leaves the sound muted.
 *
 * Moving the level unmutes, unless it is moved to nothing — so a key or a
 * slider means the same on every device. Decided before the platform is told:
 * told from the old flag, a level set while muted was drawn as unmuted and
 * played as silence.
 */
export function volumeChange(
  state: Pick<EngineState, 'muted'>,
  level: number,
): Pick<EngineState, 'volume' | 'muted'> {
  const volume = clamp01(level)
  return { volume, muted: volume === 0 ? state.muted : false }
}

/** What the platform should actually play at. */
export function audibleLevel(state: Pick<EngineState, 'volume' | 'muted'>): number {
  return state.muted ? 0 : state.volume
}

/**
 * A song this device has nowhere to play from: no copy, and neither the bucket
 * nor a server answering here. Said as an error the provider recovers from,
 * and not playing — the song before it has been stopped, or it would sound on
 * under the next song's name while the provider retries from its position.
 * The words are the app's (they name the song and this device), so each
 * engine hands them in.
 */
export function unplayableState(error: string): Partial<EngineState> {
  return {
    error,
    playing: false,
    stalled: false,
  }
}

/**
 * The song to line up behind the one sounding, for a gapless or crossfaded
 * handover, or null for none.
 *
 * Never the song that is sounding: repeat-one plays it again by going back to
 * the top, and a second copy of it lined up behind would start without the
 * song ever being said to end — no play counted, no "end of this song" sleep.
 */
export function lookaheadId(nextId: number | null, currentId: number | null): number | null {
  return nextId === currentId ? null : nextId
}
