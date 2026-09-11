import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import type { Song } from '@selfmp3/shared'
import { mediaUrl } from '../lib/api.js'
import { appPath } from '../lib/platform.js'
import { AudioEngine, type EngineState } from './engine.js'
import {
  advance,
  cycleRepeat,
  EMPTY_QUEUE,
  enqueue as enqueueItems,
  moveItem,
  peekNext,
  playFrom as playFromQueue,
  playNext as playNextItems,
  previous as previousTrack,
  removeAt,
  setShuffle as setShuffleState,
  type QueueState,
} from './queue.js'
import { autoMixCrossfade, autoMixOrder } from './autoMix.js'
import { recordListen, recordSkipListen } from '../offline/playOutbox.js'
import { countInMs, tapLoop } from './practice.js'

/**
 * The player, exposed to the UI.
 *
 * The division of labour: `AudioEngine` owns the audio elements and pushes
 * state out imperatively; `queue.ts` owns the ordering rules as pure
 * functions; this provider is the thin layer that connects them to React and
 * to the server (play counts, media session, persistence).
 */

/**
 * Declared with property-arrow signatures rather than method shorthand.
 *
 * These are passed straight to JSX handlers — `onClick={player.toggle}` — so
 * method shorthand would make every one of those a lint error about losing
 * `this`. Property syntax is also simply more accurate: each of these is a
 * `useCallback` closure held in a property, with no receiver to lose.
 */
interface PlayerContextValue extends EngineState {
  readonly queue: QueueState
  readonly current: Song | null
  readonly queueSongs: readonly Song[]
  readonly sleepTimerEndsAt: number | null
  /** Auto-mix: upcoming songs re-ordered into a smooth path, crossfade per transition. */
  readonly autoMix: boolean
  /** Seconds the next handover will fade over, after auto-mix has had its say. */
  readonly nextCrossfadeSeconds: number

  readonly playFrom: (songs: readonly Song[], index: number) => void
  readonly playSong: (song: Song) => void
  readonly toggle: () => void
  readonly play: () => void
  readonly pause: () => void
  /**
   * Replace the queue and load a position, playing or paused — the hook that
   * device handoff, remote commands and "continue from your phone" use.
   * Resolves once the track is loaded, so a follow-up seek lands.
   */
  readonly playQueue: (songIds: readonly number[], index: number, options?: PlayQueueOptions) => Promise<void>
  readonly next: () => void
  readonly previous: () => void
  readonly seek: (seconds: number) => void
  readonly seekBy: (delta: number) => void
  readonly setVolume: (volume: number) => void
  readonly toggleMute: () => void
  readonly setRate: (rate: number) => void
  readonly toggleShuffle: () => void
  readonly cycleRepeatMode: () => void
  readonly playNext: (songs: readonly Song[]) => void
  readonly addToQueue: (songs: readonly Song[]) => void
  readonly removeFromQueue: (position: number) => void
  readonly reorderQueue: (from: number, to: number) => void
  readonly jumpTo: (position: number) => void
  readonly clearQueue: () => void
  readonly setSleepTimer: (minutes: number | null) => void
  readonly setAutoMix: (on: boolean) => void

  // --- practice ------------------------------------------------------------
  /** Set A or B of the loop from the current playhead. */
  readonly tapLoopPoint: (which: 'A' | 'B') => void
  /** Loop an exact region, e.g. one lyric line from its timestamps. */
  readonly setLoop: (a: number, b: number) => void
  readonly clearLoop: () => void

  // --- for animation -------------------------------------------------------
  /** The playhead right now, finer than `currentTime`; read it per frame. */
  readonly playhead: () => number
  /** Live frequency data for the spectrum visuals. Desktop only; see the engine. */
  readonly analyser: () => AnalyserNode | null
  readonly setPreservesPitch: (on: boolean) => void
  /** Whether a restart of the loop waits one beat first. */
  readonly countIn: boolean
  readonly setCountIn: (on: boolean) => void
}

export interface PlayQueueOptions {
  readonly position?: number
  readonly autoplay?: boolean
  readonly shuffle?: boolean
  readonly repeat?: QueueState['repeat']
}

const PlayerContext = createContext<PlayerContextValue | null>(null)

export function usePlayer(): PlayerContextValue {
  const context = useContext(PlayerContext)
  if (!context) throw new Error('usePlayer must be used inside <PlayerProvider>')
  return context
}

const QUEUE_STORAGE_KEY = 'selfmp3:queue'
const VOLUME_STORAGE_KEY = 'selfmp3:volume'
const AUTO_MIX_STORAGE_KEY = 'selfmp3:automix'
const PITCH_LOCK_STORAGE_KEY = 'selfmp3:pitchlock'
const COUNT_IN_STORAGE_KEY = 'selfmp3:countin'

interface PersistedQueue {
  items: number[]
  index: number
  original: number[]
  shuffle: boolean
  repeat: QueueState['repeat']
}

export function PlayerProvider({
  songs,
  crossfadeSeconds,
  gapless,
  playThreshold,
  children,
}: {
  songs: readonly Song[]
  crossfadeSeconds: number
  gapless: boolean
  playThreshold: number
  children: ReactNode
}): ReactNode {
  const engineRef = useRef<AudioEngine | null>(null)
  engineRef.current ??= new AudioEngine()
  const engine = engineRef.current

  const [queue, setQueue] = useState<QueueState>(() => restoreQueue())
  const [sleepTimerEndsAt, setSleepTimerEndsAt] = useState<number | null>(null)
  const [autoMix, setAutoMixState] = useState<boolean>(() => restoreAutoMix())
  const [countIn, setCountInState] = useState<boolean>(() => restoreFlag(COUNT_IN_STORAGE_KEY, false))

  // Refs mirroring state, so the engine's imperative callbacks always see the
  // latest values without being re-created (and re-subscribed) on every render.
  const queueRef = useRef(queue)
  queueRef.current = queue

  const songById = useMemo(() => new Map(songs.map(song => [song.id, song])), [songs])
  const songByIdRef = useRef(songById)
  songByIdRef.current = songById

  const autoMixRef = useRef(autoMix)
  autoMixRef.current = autoMix

  /** With auto-mix on, anything that changes the upcoming list re-smooths it. */
  const mixed = useCallback(
    (state: QueueState): QueueState =>
      autoMixRef.current ? autoMixOrder(state, songByIdRef.current) : state,
    [],
  )

  /**
   * Bridge the engine's imperative state into React.
   *
   * `useSyncExternalStore` is the correct primitive here: it subscribes
   * without an effect, and it cannot tear during a concurrent render the way
   * a `useState` + `useEffect` pair can.
   */
  const engineState = useSyncExternalStore(
    useCallback((listener: () => void) => engine.subscribe(listener), [engine]),
    () => engine.state,
    () => engine.state,
  )

  // --- play counting -------------------------------------------------------

  const playTrackingRef = useRef({ songId: -1, counted: false, listenedSeconds: 0, lastTime: 0 })

  useEffect(() => {
    engine.onProgress = (currentTime, duration) => {
      const tracking = playTrackingRef.current
      const currentId = queueRef.current.items[queueRef.current.index]
      if (currentId === undefined) return

      if (tracking.songId !== currentId) {
        playTrackingRef.current = {
          songId: currentId,
          counted: false,
          listenedSeconds: 0,
          lastTime: currentTime,
        }
        return
      }

      // Accumulate only forward movement, so scrubbing back and forth cannot
      // inflate a play count.
      const delta = currentTime - tracking.lastTime
      if (delta > 0 && delta < 2) tracking.listenedSeconds += delta
      tracking.lastTime = currentTime

      if (tracking.counted || duration <= 0) return

      // A play counts at the configured fraction, capped at four minutes so a
      // long track is not held hostage.
      const needed = Math.min(duration * playThreshold, 240)
      if (tracking.listenedSeconds >= needed) {
        tracking.counted = true
        // Through the outbox, not straight to the server: with the Mac asleep
        // the play is kept on the device and sent when it wakes up.
        recordListen(currentId, Math.round(tracking.listenedSeconds * 1000), false)
      }
    }
  }, [engine, playThreshold])

  // --- engine wiring -------------------------------------------------------

  const loadIndex = useCallback(
    (state: QueueState, autoplay: boolean) => {
      const songId = state.items[state.index]
      if (songId === undefined) return
      void engine.load(songId, { autoplay })
    },
    [engine],
  )

  useEffect(() => {
    engine.nextTrackId = () => peekNext(queueRef.current)
    engine.streamUrl = songId => mediaUrl.stream(songId, songByIdRef.current.get(songId)?.rev)

    engine.onTrackEnd = () => {
      const tracking = playTrackingRef.current
      const finishedId = queueRef.current.items[queueRef.current.index]
      if (finishedId !== undefined && !tracking.counted) {
        recordListen(finishedId, Math.round(tracking.listenedSeconds * 1000), true)
        tracking.counted = true
      }

      const { state, stop } = advance(queueRef.current, true)
      if (stop) {
        engine.pause()
        return
      }

      setQueue(state)
      // With repeat-one the index does not change, so restart explicitly.
      if (state.index === queueRef.current.index && state.repeat === 'one') {
        engine.seek(0)
        void engine.play()
      } else {
        loadIndex(state, true)
      }
    }

    return () => {
      engine.nextTrackId = null
      engine.streamUrl = null
      engine.onTrackEnd = null
    }
  }, [engine, loadIndex])

  // --- current and next ------------------------------------------------------

  const current = useMemo(() => {
    const id = queue.items[queue.index]
    return id === undefined ? null : (songById.get(id) ?? null)
  }, [queue.items, queue.index, songById])

  const nextSong = useMemo(() => {
    const id = peekNext(queue)
    return id === null ? null : (songById.get(id) ?? null)
  }, [queue, songById])

  // Auto-mix picks the fade for each transition from the two songs' features;
  // otherwise the user's fixed setting applies.
  const nextCrossfadeSeconds = autoMix
    ? autoMixCrossfade(current, nextSong, crossfadeSeconds)
    : crossfadeSeconds

  useEffect(() => {
    engine.configure({ crossfadeSeconds: nextCrossfadeSeconds, gapless })
  }, [engine, nextCrossfadeSeconds, gapless])

  // Restore the saved volume once, on mount.
  useEffect(() => {
    const raw = localStorage.getItem(VOLUME_STORAGE_KEY)
    // `Number(null)` is 0, so an unguarded read starts every fresh browser
    // silent — and with the slider at zero it is not obvious why.
    if (raw === null) return
    const stored = Number(raw)
    if (Number.isFinite(stored) && stored >= 0 && stored <= 1) engine.setVolume(stored)
  }, [engine])

  useEffect(() => () => engine.destroy(), [engine])

  // --- persistence ---------------------------------------------------------

  useEffect(() => {
    const payload: PersistedQueue = {
      items: [...queue.items],
      index: queue.index,
      original: [...queue.original],
      shuffle: queue.shuffle,
      repeat: queue.repeat,
    }
    try {
      localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(payload))
    } catch {
      // Private browsing; the queue simply will not survive a reload.
    }
  }, [queue])

  const queueSongs = useMemo(() => {
    const out: Song[] = []
    for (const id of queue.items) {
      const song = songById.get(id)
      if (song) out.push(song)
    }
    return out
  }, [queue.items, songById])

  // --- controls ------------------------------------------------------------

  const playFrom = useCallback(
    (list: readonly Song[], index: number) => {
      const next = mixed(
        playFromQueue(
          queueRef.current,
          list.map(song => song.id),
          index,
        ),
      )
      setQueue(next)
      loadIndex(next, true)
    },
    [loadIndex, mixed],
  )

  const playSong = useCallback(
    (song: Song) => {
      playFrom([song], 0)
    },
    [playFrom],
  )

  /**
   * Load the queue's current song if the audio element does not hold it.
   *
   * After a reload the queue comes back from storage and the player bar shows
   * its song, but nothing is in the audio element yet. A bare play() on an
   * empty element fires "play" and then "waiting" forever — the bar showed a
   * pause button and a buffering spinner and never made a sound, while the
   * row's own play button (which loads first) worked. Returns true when it
   * started a load, which also starts playback.
   */
  const loadCurrentIfNeeded = useCallback((): boolean => {
    const songId = queueRef.current.items[queueRef.current.index]
    if (songId === undefined || engine.currentSongId === songId) return false
    void engine.load(songId, { autoplay: true })
    return true
  }, [engine])

  const toggle = useCallback(() => {
    if (!loadCurrentIfNeeded()) void engine.toggle()
  }, [engine, loadCurrentIfNeeded])
  const play = useCallback(() => {
    if (!loadCurrentIfNeeded()) void engine.play()
  }, [engine, loadCurrentIfNeeded])
  const pause = useCallback(() => engine.pause(), [engine])

  const playQueue = useCallback(
    async (songIds: readonly number[], index: number, options: PlayQueueOptions = {}) => {
      // Another device may know songs this one has not synced yet; keep what
      // resolves and land on the intended song if it is among them.
      const items = songIds.filter(id => songByIdRef.current.has(id))
      if (items.length === 0) return
      const wanted = songIds[index]
      const safeIndex = wanted === undefined ? 0 : Math.max(0, items.indexOf(wanted))
      const next: QueueState = {
        items,
        index: safeIndex,
        original: items,
        shuffle: options.shuffle ?? queueRef.current.shuffle,
        repeat: options.repeat ?? queueRef.current.repeat,
      }
      // The ref is updated eagerly so a heartbeat sent before the next render
      // already reports the new queue.
      queueRef.current = next
      setQueue(next)
      const songId = items[safeIndex]
      if (songId === undefined) return
      await engine.load(songId, { autoplay: options.autoplay ?? true, startAt: options.position ?? 0 })
    },
    [engine],
  )

  const next = useCallback(() => {
    const currentId = queueRef.current.items[queueRef.current.index]
    // A manual skip past the halfway point is a signal about the song, so it
    // is recorded — that is what makes "songs I always skip" possible.
    if (currentId !== undefined && !playTrackingRef.current.counted) {
      recordSkipListen(currentId, engine.state.currentTime)
    }

    const { state, stop } = advance(queueRef.current, false)
    if (stop) return
    setQueue(state)
    loadIndex(state, true)
  }, [engine, loadIndex])

  const previous = useCallback(() => {
    // Standard player behaviour: restart the track unless you press it again
    // quickly at the very start.
    if (engine.state.currentTime > 3) {
      engine.seek(0)
      return
    }
    const state = previousTrack(queueRef.current)
    if (state === queueRef.current) {
      engine.seek(0)
      return
    }
    setQueue(state)
    loadIndex(state, true)
  }, [engine, loadIndex])

  const seek = useCallback((seconds: number) => engine.seek(seconds), [engine])

  const seekBy = useCallback(
    (delta: number) => engine.seek(engine.state.currentTime + delta),
    [engine],
  )

  const setVolume = useCallback(
    (volume: number) => {
      engine.setVolume(volume)
      try {
        localStorage.setItem(VOLUME_STORAGE_KEY, String(volume))
      } catch {
        // Not worth surfacing.
      }
    },
    [engine],
  )

  const toggleMute = useCallback(() => engine.setMuted(!engine.state.muted), [engine])
  const setRate = useCallback((rate: number) => engine.setRate(rate), [engine])

  const toggleShuffle = useCallback(() => {
    setQueue(state => setShuffleState(state, !state.shuffle))
  }, [])

  const cycleRepeatMode = useCallback(() => {
    setQueue(state => ({ ...state, repeat: cycleRepeat(state.repeat) }))
  }, [])

  // "Play next" is an explicit choice about order, so auto-mix leaves it be;
  // "add to queue" is not, so the additions are folded into the path.
  const playNext = useCallback((list: readonly Song[]) => {
    setQueue(state => playNextItems(state, list.map(song => song.id)))
  }, [])

  const addToQueue = useCallback(
    (list: readonly Song[]) => {
      setQueue(state => mixed(enqueueItems(state, list.map(song => song.id))))
    },
    [mixed],
  )

  const removeFromQueue = useCallback(
    (position: number) => {
      setQueue(state => {
        const wasCurrent = position === state.index
        const next = removeAt(state, position)
        if (wasCurrent && next.items.length > 0) loadIndex(next, engine.state.playing)
        else if (next.items.length === 0) engine.pause()
        return next
      })
    },
    [engine, loadIndex],
  )

  const reorderQueue = useCallback((from: number, to: number) => {
    setQueue(state => moveItem(state, from, to))
  }, [])

  const jumpTo = useCallback(
    (position: number) => {
      setQueue(state => {
        if (position < 0 || position >= state.items.length) return state
        const next = { ...state, index: position }
        loadIndex(next, true)
        return next
      })
    },
    [loadIndex],
  )

  const clearQueue = useCallback(() => {
    engine.pause()
    setQueue(state => ({ ...state, items: [], index: -1, original: [] }))
  }, [engine])

  // --- auto-mix ------------------------------------------------------------

  const setAutoMix = useCallback((on: boolean) => {
    setAutoMixState(on)
    autoMixRef.current = on
    try {
      localStorage.setItem(AUTO_MIX_STORAGE_KEY, on ? '1' : '0')
    } catch {
      // Not worth surfacing.
    }
    // Turning it on smooths what is already queued; turning it off keeps the
    // order as it is, since there is no "original" worth going back to.
    if (on) setQueue(state => autoMixOrder(state, songByIdRef.current))
  }, [])

  // --- practice ------------------------------------------------------------

  const tapLoopPoint = useCallback(
    (which: 'A' | 'B') => {
      const { a, b } = tapLoop(which, engine.state.currentTime, {
        a: engine.state.loopA,
        b: engine.state.loopB,
      })
      engine.setLoop(a, b)
    },
    [engine],
  )

  const setLoop = useCallback((a: number, b: number) => engine.setLoop(a, b), [engine])
  const clearLoop = useCallback(() => engine.clearLoop(), [engine])
  const playhead = useCallback(() => engine.playhead, [engine])
  const analyser = useCallback(() => engine.analyser(), [engine])

  const setPreservesPitch = useCallback(
    (on: boolean) => {
      engine.setPreservesPitch(on)
      try {
        localStorage.setItem(PITCH_LOCK_STORAGE_KEY, on ? '1' : '0')
      } catch {
        // Not worth surfacing.
      }
    },
    [engine],
  )

  const setCountIn = useCallback((on: boolean) => {
    setCountInState(on)
    try {
      localStorage.setItem(COUNT_IN_STORAGE_KEY, on ? '1' : '0')
    } catch {
      // Not worth surfacing.
    }
  }, [])

  // Restore the pitch-lock preference once, on mount. Default is on, which is
  // what INITIAL_STATE already has, so only an explicit "off" needs applying.
  useEffect(() => {
    if (!restoreFlag(PITCH_LOCK_STORAGE_KEY, true)) engine.setPreservesPitch(false)
  }, [engine])

  // The count-in is one beat of *this* song, so it follows the current track.
  useEffect(() => {
    engine.setCountIn(countIn ? countInMs(current?.features?.bpm) : 0)
  }, [engine, countIn, current?.features?.bpm])

  // --- sleep timer ---------------------------------------------------------

  const setSleepTimer = useCallback((minutes: number | null) => {
    setSleepTimerEndsAt(minutes === null ? null : Date.now() + minutes * 60_000)
  }, [])

  useEffect(() => {
    if (sleepTimerEndsAt === null) return

    const timer = setInterval(() => {
      if (Date.now() < sleepTimerEndsAt) return
      clearInterval(timer)
      setSleepTimerEndsAt(null)

      // Fade out over four seconds rather than cutting off, which is much
      // gentler if you are actually falling asleep to it.
      const startVolume = engine.state.volume
      const steps = 40
      let step = 0
      const fade = setInterval(() => {
        step++
        engine.setVolume(startVolume * (1 - step / steps))
        if (step >= steps) {
          clearInterval(fade)
          engine.pause()
          engine.setVolume(startVolume)
        }
      }, 100)
    }, 1_000)

    return () => clearInterval(timer)
  }, [sleepTimerEndsAt, engine])

  // --- media session -------------------------------------------------------

  useEffect(() => {
    if (!('mediaSession' in navigator)) return

    if (current) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: current.title,
        artist: current.artist || 'Unknown artist',
        album: current.album,
        artwork: current.hasArt
          ? [
              { src: mediaUrl.art(current.id, current.rev), sizes: '512x512', type: 'image/jpeg' },
              { src: mediaUrl.art(current.id, current.rev), sizes: '192x192', type: 'image/jpeg' },
            ]
          : [{ src: appPath('icons/icon-512.png'), sizes: '512x512', type: 'image/png' }],
      })
    }

    navigator.mediaSession.playbackState = engineState.playing ? 'playing' : 'paused'

    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      // The lock screen's play resumes a restored queue the same way the bar does.
      ['play', () => play()],
      ['pause', () => engine.pause()],
      ['previoustrack', () => previous()],
      ['nexttrack', () => next()],
      ['seekbackward', () => seekBy(-10)],
      ['seekforward', () => seekBy(10)],
      [
        'seekto',
        details => {
          if (details.seekTime != null) seek(details.seekTime)
        },
      ],
      ['stop', () => engine.pause()],
    ]

    for (const [action, handler] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler)
      } catch {
        // Not every browser supports every action; that is fine.
      }
    }

    return () => {
      for (const [action] of handlers) {
        try {
          navigator.mediaSession.setActionHandler(action, null)
        } catch {
          // Ignore.
        }
      }
    }
  }, [current, engineState.playing, engine, next, previous, seek, seekBy, play])

  // Keep the lock-screen scrubber in sync with real playback position.
  useEffect(() => {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return
    if (!Number.isFinite(engineState.duration) || engineState.duration <= 0) return
    try {
      navigator.mediaSession.setPositionState({
        duration: engineState.duration,
        playbackRate: engineState.rate,
        position: Math.min(engineState.currentTime, engineState.duration),
      })
    } catch {
      // Safari throws if position exceeds duration during a seek; harmless.
    }
  }, [engineState.duration, engineState.currentTime, engineState.rate])

  const value = useMemo<PlayerContextValue>(
    () => ({
      ...engineState,
      queue,
      current,
      queueSongs,
      sleepTimerEndsAt,
      autoMix,
      nextCrossfadeSeconds,
      playFrom,
      playSong,
      toggle,
      play,
      pause,
      playQueue,
      next,
      previous,
      seek,
      seekBy,
      setVolume,
      toggleMute,
      setRate,
      toggleShuffle,
      cycleRepeatMode,
      playNext,
      addToQueue,
      removeFromQueue,
      reorderQueue,
      jumpTo,
      clearQueue,
      setSleepTimer,
      setAutoMix,
      tapLoopPoint,
      setLoop,
      clearLoop,
      playhead,
      analyser,
      setPreservesPitch,
      countIn,
      setCountIn,
    }),
    [
      engineState,
      queue,
      current,
      queueSongs,
      sleepTimerEndsAt,
      autoMix,
      nextCrossfadeSeconds,
      autoMix,
      nextCrossfadeSeconds,
      playFrom,
      playSong,
      toggle,
      play,
      pause,
      playQueue,
      next,
      previous,
      seek,
      seekBy,
      setVolume,
      toggleMute,
      setRate,
      toggleShuffle,
      cycleRepeatMode,
      playNext,
      addToQueue,
      removeFromQueue,
      reorderQueue,
      jumpTo,
      clearQueue,
      setSleepTimer,
      setAutoMix,
      tapLoopPoint,
      setLoop,
      clearLoop,
      playhead,
      analyser,
      setPreservesPitch,
      countIn,
      setCountIn,
    ],
  )

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
}

function restoreAutoMix(): boolean {
  try {
    return localStorage.getItem(AUTO_MIX_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/** A stored on/off preference, falling back to `fallback` when unset. */
function restoreFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : raw === '1'
  } catch {
    return fallback
  }
}

/** Restore the queue from a previous session, defensively. */
function restoreQueue(): QueueState {
  try {
    const raw = localStorage.getItem(QUEUE_STORAGE_KEY)
    if (!raw) return EMPTY_QUEUE
    const parsed = JSON.parse(raw) as Partial<PersistedQueue>
    if (!Array.isArray(parsed.items)) return EMPTY_QUEUE

    const items = parsed.items.filter((id): id is number => Number.isInteger(id))
    const index = typeof parsed.index === 'number' ? parsed.index : -1

    return {
      items,
      // Never auto-resume mid-queue into a bad index.
      index: index >= 0 && index < items.length ? index : items.length > 0 ? 0 : -1,
      original: Array.isArray(parsed.original)
        ? parsed.original.filter((id): id is number => Number.isInteger(id))
        : items,
      shuffle: parsed.shuffle === true,
      repeat:
        parsed.repeat === 'all' || parsed.repeat === 'one' || parsed.repeat === 'off'
          ? parsed.repeat
          : 'off',
    }
  } catch {
    return EMPTY_QUEUE
  }
}
