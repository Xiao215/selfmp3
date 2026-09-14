import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { ReactNode } from 'react'
import { AppState } from 'react-native'
import { useQueryClient } from '@tanstack/react-query'
import {
  cycleRepeat,
  EMPTY_QUEUE,
  enqueue as enqueueIds,
  moveItem,
  peekNext,
  playFrom,
  playNext as playNextIds,
  previous as previousInQueue,
  removeAt,
  resolveQueue,
  setShuffle,
  type QueueState,
  type Song,
} from '@selfmp3/shared'
import {
  advancePlayable,
  autoMixCrossfade,
  autoMixOrder,
  countInMs,
  type EngineState,
  listenedDelta,
  peekPlayable,
  queryKeys,
  secondsToCount,
  tapLoop,
} from '@selfmp3/client'
import { mediaUrlFor } from '../api/client'
import { prefs } from '../ports/prefs'
import { useLibrary, useServerSettings } from '../api/queries'
import { coversNow, onCoversChanged } from '../offline/covers'
import { useDownloads } from '../offline/DownloadsProvider'
import { flushListens, recordListen } from '../offline/listenOutbox'
import { createEngine } from '../ports/engine'
import { useConnection } from '../server/ConnectionProvider'
import { useNowPlaying } from './useNowPlaying'
import {
  createProgressStore,
  createValueStore,
  differsBesidesClock,
  samePlayback,
  songPlayback,
  type PlayerProgress,
  type ProgressStore,
  type SongPlaybackState,
  type ValueStore,
} from './progress.model'

export type { PlayerProgress }

/**
 * The React glue between the queue rules and whatever makes a sound.
 *
 * Phase 3's point. This file used to drive react-native-track-player directly:
 * it handed the player the whole queue, then spent half its length keeping two
 * ideas of "which song is playing" in step — the pure `QueueState` and the
 * native player's index — and reconciling the events that arrived while a load
 * was still in flight. The web app's provider had the same job and none of
 * that code, because it drives an engine one song at a time.
 *
 * Now they are the same shape, because they are written against the same
 * `PlaybackEngine`. `QueueState` is the only source of truth for order *and*
 * position; the engine plays the song it is handed and says when that song
 * ended. On the phone `engine.ts` keeps one song queued behind the current one
 * so the handover stays gapless and the lock screen has a Next to offer —
 * which is the engine's business, not this file's, and the reason the index
 * reconciliation is gone rather than moved.
 *
 * What is still the phone's here: the listen outbox flushing when the app
 * comes back to the foreground, which is a phone's nearest thing to "the Mac
 * might be awake now".
 */

export interface PlayerApi {
  readonly queue: QueueState
  readonly songs: readonly Song[]
  readonly current: Song | null
  readonly isPlaying: boolean
  readonly ready: boolean
  /**
   * Start these songs here; `shuffle` sets the mode first, else it is kept.
   * `position` starts the first song part-way, which is what a handoff needs:
   * a separate `seekTo` straight after would land before the track has loaded
   * and be lost.
   */
  playFrom: (
    songIds: readonly number[],
    startIndex: number,
    shuffle?: boolean,
    position?: number,
    /** False loads the song paused: a resume offer, which never starts audio by itself. */
    autoplay?: boolean,
  ) => void
  playShuffled: (songIds: readonly number[]) => void
  jumpTo: (index: number) => void
  toggle: () => void
  next: () => void
  previous: () => void
  seekTo: (seconds: number) => void
  /**
   * Forward or back from where the song is now: the menu's seek items, and the
   * OS's own skip buttons. Separate from `seekTo` because the position ticks
   * once a second in its own context, and everything that only wants to *move*
   * the song would otherwise have to re-render on every tick to know where it is.
   */
  seekBy: (delta: number) => void
  /**
   * Where the song is right now, read rather than subscribed to: for a saved
   * session or a heartbeat, which want the position when they are written and
   * have no reason to re-render while it moves. `usePlayerProgress` is the
   * subscribing one, for what draws it.
   */
  getPosition: () => number
  /** Called whenever the position or length moves; read them with `getPosition`. */
  subscribeProgress: (listener: () => void) => () => void
  toggleShuffle: () => void
  cycleRepeatMode: () => void
  playNext: (songIds: readonly number[]) => void
  addToQueue: (songIds: readonly number[]) => void
  removeFromQueue: (index: number) => void
  reorderQueue: (from: number, to: number) => void
  /** Empty the queue and stop, as the web's bin in Up next does. */
  clearQueue: () => void
  /** 0–1, as the engine has it; the bar's slider and the web's share one scale. */
  readonly volume: number
  readonly muted: boolean
  /** Playback speed: 1 is normal. */
  readonly rate: number
  /** When the sleep timer stops playback, or null when none is set. */
  readonly sleepTimerEndsAt: number | null
  setVolume: (volume: number) => void
  toggleMute: () => void
  setRate: (rate: number) => void
  /** Minutes from now, or null to cancel. */
  setSleepTimer: (minutes: number | null) => void

  // --- auto-mix ------------------------------------------------------------
  /** Upcoming songs kept in a smooth order by tempo, key and energy. */
  readonly autoMix: boolean
  /** Whether this engine fades one song into the next; a phone's cannot. */
  readonly canCrossfade: boolean
  /** The fade into the next song: auto-mix's pick, or the Mac's setting. */
  readonly nextCrossfadeSeconds: number
  setAutoMix: (on: boolean) => void

  // --- practice ------------------------------------------------------------
  /** Whether this engine can loop A to B closely; a phone's cannot, yet. */
  readonly canLoop: boolean
  readonly loopA: number | null
  readonly loopB: number | null
  /** The pause before a loop starts again, while it is happening. */
  readonly countingIn: boolean
  readonly preservesPitch: boolean
  /** Whether a restart of the loop waits one beat first. */
  readonly countIn: boolean
  /** Set A or B of the loop from where the song is now. */
  tapLoopPoint: (which: 'A' | 'B') => void
  clearLoop: () => void
  setPreservesPitch: (on: boolean) => void
  setCountIn: (on: boolean) => void
}

/** Where this device keeps its volume, as the web app does. */
const VOLUME_KEY = 'volume'
/** Practice preferences, kept on this device as the web keeps them. */
const PITCH_LOCK_KEY = 'pitchlock'
const COUNT_IN_KEY = 'countin'
const AUTO_MIX_KEY = 'automix'

const PlayerContext = createContext<PlayerApi | null>(null)

/**
 * The facts that move too often, or matter to too few, to ride in `PlayerApi`.
 *
 * Made once per provider and never replaced, so this context itself never
 * changes; each hook below subscribes to the one store it reads. `stalled`
 * used to be in `PlayerApi`, and every waiting/playing pair from the network
 * re-rendered every screen and row that asked for the player.
 */
interface PlayerStores {
  readonly progress: ProgressStore
  readonly playback: ValueStore<SongPlaybackState>
  readonly stalled: ValueStore<boolean>
}

const PlayerStoresContext = createContext<PlayerStores | null>(null)

/** Plays, as far as caches go: the library's counts and the stats drawn from them. */
const STATS_KEY = ['stats'] as const

interface PlayTracking {
  songId: number | null
  listenedSeconds: number
  counted: boolean
}

export function PlayerProvider({ children }: { children: ReactNode }): ReactNode {
  const { connection } = useConnection()
  const library = useLibrary()
  const { queue: downloadQueue, checkPlay, mayPlay, keepPlayed } = useDownloads()
  const { data: serverSettings } = useServerSettings()

  // Built once and kept: an engine outlives every render, and rebuilding it
  // would mean dropping the audio that is playing. Its wiring is handed over
  // with `connect` rather than assigned, which is the same point made in the
  // port.
  const [engine] = useState(createEngine)
  const [queue, setQueue] = useState<QueueState>(EMPTY_QUEUE)
  const [engineState, setEngineState] = useState<EngineState>(() => engine.state)
  const [sleepTimerEndsAt, setSleepTimerEndsAt] = useState<number | null>(null)
  const [countIn, setCountInState] = useState(() => prefs.get(COUNT_IN_KEY) === '1')
  const [autoMix, setAutoMixState] = useState(() => prefs.get(AUTO_MIX_KEY) === '1')
  const [stores] = useState<PlayerStores>(() => ({
    progress: createProgressStore(),
    playback: createValueStore<SongPlaybackState>({ songId: null, playing: false }, samePlayback),
    stalled: createValueStore(false),
  }))

  const songsById = useMemo(() => {
    const map = new Map<number, Song>()
    for (const song of library.data?.songs ?? []) map.set(song.id, song)
    return map
  }, [library.data])

  // Refs so the engine's callbacks always see current values without being
  // torn down and rewired on every render.
  const queueRef = useRef(queue)
  const songsRef = useRef(songsById)
  const connectionRef = useRef(connection)
  const trackingRef = useRef<PlayTracking>({ songId: null, listenedSeconds: 0, counted: false })
  const lastPositionRef = useRef(0)
  const autoMixRef = useRef(autoMix)

  useEffect(() => {
    queueRef.current = queue
  }, [queue])
  useEffect(() => {
    songsRef.current = songsById
  }, [songsById])
  useEffect(() => {
    autoMixRef.current = autoMix
  }, [autoMix])

  /** With auto-mix on, anything that brings new songs into Up next re-smooths it, as on the web. */
  const mixed = useCallback(
    (state: QueueState): QueueState =>
      autoMixRef.current ? autoMixOrder(state, songsRef.current) : state,
    [],
  )
  useEffect(() => {
    connectionRef.current = connection
  }, [connection])

  /*
   * The clock to its store, everything else to state.
   *
   * `setEngineState` keeps the previous object when only the clock moved, and
   * React skips a render for a state set to what it already is — so a tick no
   * longer renders this provider at all, and only what subscribes to the
   * progress store (the scrubbers, the synced lyrics) hears it.
   */
  useEffect(
    () =>
      engine.subscribe(state => {
        stores.progress.set(state.currentTime, state.duration)
        stores.stalled.set(state.stalled)
        setEngineState(previous => (differsBesidesClock(previous, state) ? state : previous))
      }),
    [engine, stores],
  )

  // Restore the saved volume once. An unguarded Number(null) is 0, which would
  // start every fresh install silent with no hint why.
  useEffect(() => {
    const raw = prefs.get(VOLUME_KEY)
    if (raw === null) return
    const stored = Number(raw)
    if (Number.isFinite(stored) && stored >= 0 && stored <= 1) engine.setVolume(stored)
  }, [engine])
  useEffect(() => () => engine.destroy(), [engine])

  // --- play reporting ------------------------------------------------------

  const flushPlay = useCallback(
    (completed: boolean) => {
      const tracking = trackingRef.current
      const songId = tracking.songId
      if (songId === null || tracking.counted) return

      const song = songsRef.current.get(songId)
      const needed = secondsToCount(song?.duration ?? 0)
      if (!completed && tracking.listenedSeconds < needed) return

      tracking.counted = true
      // Kept on the phone first: with the Mac asleep it goes when the Mac wakes.
      recordListen(songId, Math.round(tracking.listenedSeconds * 1000), completed)
      // A song listened to is one worth having here, where songs stream from the bucket.
      keepPlayed(songId)
    },
    [keepPlayed],
  )

  const queryClient = useQueryClient()
  useEffect(() => {
    const flush = (): void => {
      void flushListens().then(sent => {
        // Only what a play changes. Invalidating everything refetched every
        // query on the page — lyrics, playlists, settings — for a play count.
        if (sent > 0) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.library })
          void queryClient.invalidateQueries({ queryKey: STATS_KEY })
        }
      })
    }
    flush()
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') flush()
    })
    return () => subscription.remove()
  }, [connection, queryClient])

  // --- engine wiring -------------------------------------------------------

  const loadIndex = useCallback(
    (state: QueueState, autoplay: boolean, startAt?: number) => {
      const songId = state.items[state.index]
      if (songId === undefined) return
      trackingRef.current = { songId, listenedSeconds: 0, counted: false }
      // Starting part-way is not listening to the part skipped.
      lastPositionRef.current = startAt ?? 0
      void engine.load(songId, startAt ? { autoplay, startAt } : { autoplay })
    },
    [engine],
  )

  useEffect(() => {
    return engine.connect({
      // Past songs that cannot play here, so a lookahead never preloads one.
      nextTrackId: () => peekPlayable(queueRef.current, mayPlay),

      streamUrl: songId => {
        // The local file wins whenever there is one: that is what the download
        // queue is for, and it is the only thing that plays with no signal.
        const local = downloadQueue.localUri(songId)
        if (local) return local
        const server = connectionRef.current
        if (!server) return ''
        return mediaUrlFor(server).stream(songId, songsRef.current.get(songId)?.rev)
      },

      trackMetadata: songId => {
        const song = songsRef.current.get(songId)
        if (!song) return null
        const server = connectionRef.current
        return {
          title: song.title,
          artist: song.artist,
          album: song.album,
          // Art needs a header the OS player cannot send, so a bucket song has
          // none until its cover is downloaded beside the audio.
          ...(song.hasArt && server ? { artwork: mediaUrlFor(server).art(song.id, song.rev) } : {}),
          ...(song.duration > 0 ? { duration: song.duration } : {}),
          contentType: song.mime,
        }
      },

      onProgress: position => {
        const tracking = trackingRef.current
        tracking.listenedSeconds += listenedDelta(position, lastPositionRef.current)
        lastPositionRef.current = position
        if (!tracking.counted) flushPlay(false)
      },

      onTrackEnd: () => {
        // A song that ran out counts however little of it was heard after the
        // threshold — it finished, which is the strongest evidence there is.
        flushPlay(true)

        // Past songs that cannot play here: one not on the phone, offline,
        // would otherwise load and sit paused with no word.
        const { state, stop } = advancePlayable(queueRef.current, true, mayPlay)
        if (stop) {
          engine.pause()
          return
        }

        setQueue(state)
        // Repeat-one leaves the index alone, so say explicitly to start again.
        if (state.index === queueRef.current.index && state.repeat === 'one') {
          engine.seek(0)
          void engine.play()
          trackingRef.current = {
            songId: state.items[state.index] ?? null,
            listenedSeconds: 0,
            counted: false,
          }
          lastPositionRef.current = 0
        } else {
          loadIndex(state, true)
        }
      },
    })
  }, [engine, loadIndex, flushPlay, downloadQueue, mayPlay])

  // --- commands ------------------------------------------------------------

  const play = useCallback(
    (
      songIds: readonly number[],
      startIndex: number,
      shuffle?: boolean,
      position?: number,
      autoplay = true,
    ) => {
      const start = (): void => {
        // "Play" on a list means in order, as on the web; a tapped row keeps
        // whatever mode is on.
        const from = shuffle === undefined ? queueRef.current : { ...queueRef.current, shuffle }
        const next = mixed(playFrom(from, songIds, startIndex))
        setQueue(next)
        loadIndex(next, autoplay, position)
      }
      // A song that cannot play here says why, rather than loading and sitting
      // paused; one that needs a yes (mobile data) starts once it has one.
      const songId = songIds[startIndex]
      if (songId !== undefined && !checkPlay(songId, start)) return
      start()
    },
    [loadIndex, checkPlay, mixed],
  )

  /**
   * "Shuffle" as a verb: turn shuffle on, pick a random starting track, play.
   *
   * `playFrom` keeps the chosen track first and shuffles the rest behind it,
   * so choosing the start at random is what makes this genuinely random rather
   * than "always begins with track one".
   */
  const playShuffled = useCallback(
    (songIds: readonly number[]) => {
      if (songIds.length === 0) return
      const begin = (start: number): void => {
        const next = playFrom({ ...queueRef.current, shuffle: true }, songIds, start)
        setQueue(next)
        loadIndex(next, true)
      }
      // Start on a song that can play here, when there is one.
      const playable = songIds.flatMap((id, index) => (mayPlay(id) ? [index] : []))
      const start =
        playable.length > 0
          ? (playable[Math.floor(Math.random() * playable.length)] ?? 0)
          : Math.floor(Math.random() * songIds.length)
      const songId = songIds[start]
      if (songId !== undefined && !checkPlay(songId, () => begin(start))) return
      begin(start)
    },
    [loadIndex, checkPlay, mayPlay],
  )

  const jumpTo = useCallback(
    (index: number) => {
      const go = (): void => {
        const next = { ...queueRef.current, index }
        setQueue(next)
        loadIndex(next, true)
      }
      const songId = queueRef.current.items[index]
      if (songId !== undefined && !checkPlay(songId, go)) return
      go()
    },
    [loadIndex, checkPlay],
  )

  const toggle = useCallback(() => {
    if (engine.state.playing) engine.pause()
    else void engine.play()
  }, [engine])

  const next = useCallback(() => {
    // Pressing Next is not the song running out: `auto` false, so repeat-one
    // moves on rather than playing the same song again.
    const { state, stop } = advancePlayable(queueRef.current, false, mayPlay)
    if (stop) return
    setQueue(state)
    loadIndex(state, true)
  }, [loadIndex, mayPlay])

  const previous = useCallback(() => {
    // Match the web: within the first few seconds "previous" means the
    // previous track, after that it means "start this one again".
    if (engine.playhead > 3) {
      engine.seek(0)
      return
    }
    const state = previousInQueue(queueRef.current)
    if (state === queueRef.current) {
      engine.seek(0)
      return
    }
    setQueue(state)
    loadIndex(state, true)
  }, [engine, loadIndex])

  const seekTo = useCallback(
    (seconds: number) => {
      engine.seek(seconds)
    },
    [engine],
  )

  const seekBy = useCallback(
    (delta: number) => {
      // The engine clamps the far end itself — an `<audio>` will not seek past
      // its duration — and this keeps the near one off negative numbers, which
      // some engines answer by refusing to seek at all.
      engine.seek(Math.max(0, lastPositionRef.current + delta))
    },
    [engine],
  )

  const toggleShuffle = useCallback(() => {
    const next = setShuffle(queueRef.current, !queueRef.current.shuffle)
    setQueue(next)
    // The song that is playing is kept; only what follows it changed, which
    // the engine picks up the next time it asks for the lookahead.
    refreshLookahead(engine)
  }, [engine])

  const cycleRepeatMode = useCallback(() => {
    const repeat = cycleRepeat(queueRef.current.repeat)
    setQueue(state => ({ ...state, repeat }))
  }, [])

  const mutateQueue = useCallback(
    (change: (state: QueueState) => QueueState) => {
      const next = change(queueRef.current)
      setQueue(next)
      queueRef.current = next
      refreshLookahead(engine)
    },
    [engine],
  )

  const playNext = useCallback(
    (songIds: readonly number[]) => mutateQueue(state => playNextIds(state, songIds)),
    [mutateQueue],
  )

  const addToQueue = useCallback(
    (songIds: readonly number[]) => mutateQueue(state => mixed(enqueueIds(state, songIds))),
    [mutateQueue, mixed],
  )

  const removeFromQueue = useCallback(
    (index: number) => {
      const wasCurrent = index === queueRef.current.index
      const next = removeAt(queueRef.current, index)
      setQueue(next)
      queueRef.current = next
      if (wasCurrent && next.items.length > 0) loadIndex(next, engine.state.playing)
      else refreshLookahead(engine)
    },
    [engine, loadIndex],
  )

  const reorderQueue = useCallback(
    (from: number, to: number) => mutateQueue(state => moveItem(state, from, to)),
    [mutateQueue],
  )

  const clearQueue = useCallback(() => {
    engine.pause()
    setQueue(EMPTY_QUEUE)
    queueRef.current = EMPTY_QUEUE
    refreshLookahead(engine)
  }, [engine])

  const setAutoMix = useCallback(
    (on: boolean) => {
      setAutoMixState(on)
      autoMixRef.current = on
      prefs.set(AUTO_MIX_KEY, on ? '1' : '0')
      // Turning it on smooths what is already queued; turning it off keeps the
      // order as it is, since there is no "original" worth going back to.
      if (on) mutateQueue(state => autoMixOrder(state, songsRef.current))
    },
    [mutateQueue],
  )

  // --- volume, speed, sleep ---------------------------------------------------

  const setVolume = useCallback(
    (volume: number) => {
      engine.setVolume(volume)
      prefs.set(VOLUME_KEY, String(volume))
    },
    [engine],
  )
  const toggleMute = useCallback(() => engine.setMuted(!engine.state.muted), [engine])
  const setRate = useCallback((rate: number) => engine.setRate(rate), [engine])

  // --- practice ---------------------------------------------------------------

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
  const clearLoop = useCallback(() => engine.clearLoop(), [engine])
  const setPreservesPitch = useCallback(
    (on: boolean) => {
      engine.setPreservesPitch(on)
      prefs.set(PITCH_LOCK_KEY, on ? '1' : '0')
    },
    [engine],
  )
  const setCountIn = useCallback((on: boolean) => {
    setCountInState(on)
    prefs.set(COUNT_IN_KEY, on ? '1' : '0')
  }, [])

  // Pitch lock is on unless this device was told otherwise.
  useEffect(() => {
    if (prefs.get(PITCH_LOCK_KEY) === '0') engine.setPreservesPitch(false)
  }, [engine])

  const setSleepTimer = useCallback((minutes: number | null) => {
    setSleepTimerEndsAt(minutes === null ? null : Date.now() + minutes * 60_000)
  }, [])

  useEffect(() => {
    if (sleepTimerEndsAt === null) return undefined
    let fade: ReturnType<typeof setInterval> | undefined
    const timer = setInterval(() => {
      if (Date.now() < sleepTimerEndsAt) return
      clearInterval(timer)
      setSleepTimerEndsAt(null)
      // Fade out over four seconds rather than cutting off, which is much
      // gentler if you are actually falling asleep to it.
      const startVolume = engine.state.volume
      const steps = 40
      let step = 0
      fade = setInterval(() => {
        step++
        engine.setVolume(startVolume * (1 - step / steps))
        if (step >= steps) {
          clearInterval(fade)
          engine.pause()
          engine.setVolume(startVolume)
        }
      }, 100)
    }, 1_000)
    return () => {
      clearInterval(timer)
      if (fade !== undefined) clearInterval(fade)
    }
  }, [sleepTimerEndsAt, engine])

  // Renamed on the way out: `resolveQueue` returns `{ songs, current }`, and a
  // `.current` read during render is indistinguishable from a ref access to
  // the React Compiler, which then gives up on memoising this component.
  const resolved = useMemo(() => {
    const { songs: queueSongs, current } = resolveQueue(queue, songsById)
    return { queueSongs, currentSong: current }
  }, [queue, songsById])

  /*
   * The fade into the next song, and gapless, told to the engine. The Mac's
   * settings hold both; nothing passed them on before this, so a browser
   * played gapless with no crossfade whatever the setting said. Auto-mix picks
   * each fade from the two songs, bounded by the setting. A phone's engine
   * ignores both: it is gapless within its own queue and cannot fade.
   */
  const crossfadeSeconds = serverSettings?.crossfadeSeconds ?? 0
  const gapless = serverSettings?.gapless ?? true
  const nextSong = useMemo(() => {
    const id = peekNext(queue)
    return id === null ? null : (songsById.get(id) ?? null)
  }, [queue, songsById])
  const currentSong = resolved.currentSong
  const nextCrossfadeSeconds = useMemo(
    () => (autoMix ? autoMixCrossfade(currentSong, nextSong, crossfadeSeconds) : crossfadeSeconds),
    [autoMix, currentSong, nextSong, crossfadeSeconds],
  )
  useEffect(() => {
    engine.configure({ crossfadeSeconds: nextCrossfadeSeconds, gapless })
  }, [engine, nextCrossfadeSeconds, gapless])

  const currentBpm = resolved.currentSong?.features?.bpm ?? null
  useEffect(() => {
    engine.setCountIn(countIn ? countInMs(currentBpm) : 0)
  }, [engine, countIn, currentBpm])

  const value = useMemo<PlayerApi>(
    () => ({
      queue,
      songs: resolved.queueSongs,
      current: resolved.currentSong,
      isPlaying: engineState.playing,
      ready: true,
      playFrom: play,
      playShuffled,
      jumpTo,
      toggle,
      next,
      previous,
      seekTo,
      seekBy,
      getPosition: stores.progress.getPosition,
      subscribeProgress: stores.progress.subscribe,
      toggleShuffle,
      cycleRepeatMode,
      playNext,
      addToQueue,
      removeFromQueue,
      reorderQueue,
      clearQueue,
      volume: engineState.volume,
      muted: engineState.muted,
      rate: engineState.rate,
      sleepTimerEndsAt,
      setVolume,
      toggleMute,
      setRate,
      setSleepTimer,
      autoMix,
      canCrossfade: engine.capabilities.crossfade,
      nextCrossfadeSeconds,
      setAutoMix,
      canLoop: engine.capabilities.loop,
      loopA: engineState.loopA,
      loopB: engineState.loopB,
      countingIn: engineState.countingIn,
      preservesPitch: engineState.preservesPitch,
      countIn,
      tapLoopPoint,
      clearLoop,
      setPreservesPitch,
      setCountIn,
    }),
    [
      engineState.volume,
      engineState.muted,
      engineState.rate,
      stores,
      sleepTimerEndsAt,
      setVolume,
      toggleMute,
      setRate,
      setSleepTimer,
      engine,
      autoMix,
      nextCrossfadeSeconds,
      setAutoMix,
      engineState.loopA,
      engineState.loopB,
      engineState.countingIn,
      engineState.preservesPitch,
      countIn,
      tapLoopPoint,
      clearLoop,
      setPreservesPitch,
      setCountIn,
      queue,
      resolved,
      engineState.playing,
      play,
      playShuffled,
      jumpTo,
      toggle,
      next,
      previous,
      seekTo,
      seekBy,
      toggleShuffle,
      cycleRepeatMode,
      playNext,
      addToQueue,
      removeFromQueue,
      reorderQueue,
      clearQueue,
    ],
  )

  // Which song rows light up. Told after the commit, and only the rows whose
  // answer changed re-render (`useSongPlayback`).
  const currentId = currentSong?.id ?? null
  useEffect(() => {
    stores.playback.set({ songId: currentId, playing: engineState.playing })
  }, [stores, currentId, engineState.playing])

  /*
   * What the operating system is shown: the lock screen on a phone, Control
   * Center and the Dock in the installed app, nothing in a tab that has no
   * media session. The artwork is a cover already on this device where there is
   * one — the OS fetches the URL itself and cannot send the doorman's header —
   * and the Mac's own address otherwise.
   *
   * The kept covers are read when they change, not on every render: reading
   * them builds a map of every cover on this device, and this provider used
   * to do that for each of its renders to look one song up.
   */
  const [keptCovers, setKeptCovers] = useState(coversNow)
  useEffect(() => onCoversChanged(() => setKeptCovers(coversNow())), [])
  const nowPlayingArt = useMemo(() => {
    if (!currentSong?.hasArt) return null
    const kept = keptCovers.get(currentSong.id)
    if (kept) return kept
    return connection ? mediaUrlFor(connection).art(currentSong.id, currentSong.rev) : null
  }, [currentSong, keptCovers, connection])
  useNowPlaying(value, stores.progress, nowPlayingArt)

  return (
    <PlayerContext.Provider value={value}>
      <PlayerStoresContext.Provider value={stores}>{children}</PlayerStoresContext.Provider>
    </PlayerContext.Provider>
  )
}

/**
 * Tell an engine that keeps a lookahead that the order behind it changed.
 *
 * Only the native engine keeps one; the web engine asks `nextTrackId` when it
 * is ready to preload and needs no prompting. Rather than have the provider
 * know which is which — which is exactly what foundation 2 forbids — this asks
 * for the method and does nothing when it is not there.
 */
function refreshLookahead(engine: unknown): void {
  const candidate = engine as { refreshLookahead?: () => void }
  candidate.refreshLookahead?.()
}

function useStores(): PlayerStores {
  const stores = useContext(PlayerStoresContext)
  if (!stores) throw new Error('player hooks must be used inside a PlayerProvider')
  return stores
}

/**
 * The song's position and length, ticking with the engine. Separate from
 * `usePlayer()` so that only the few things drawn from it — the scrubbers,
 * the bars' progress washes, the synced lyrics — are redrawn on each tick.
 * Keep it in the smallest component that draws it.
 */
export function usePlayerProgress(): PlayerProgress {
  const { progress } = useStores()
  const clock = useSyncExternalStore(progress.subscribe, progress.get, progress.get)
  // Before the engine knows the length, the library's is the best there is.
  const fallback = usePlayer().current?.duration ?? 0
  return useMemo(
    () => ({ position: clock.position, duration: clock.duration > 0 ? clock.duration : fallback }),
    [clock, fallback],
  )
}

/** Waiting on the network mid-song, which shows differently from paused. */
export function usePlayerStalled(): boolean {
  const { stalled } = useStores()
  return useSyncExternalStore(stalled.subscribe, stalled.get, stalled.get)
}

/** For a row drawn outside any player, such as a test: nothing is ever loaded. */
const NO_PLAYBACK = createValueStore<SongPlaybackState>({ songId: null, playing: false })

/**
 * `playing` or `paused` when this song is the loaded one, and null otherwise.
 *
 * What a song row asks instead of `usePlayer()`. The answer is a primitive per
 * row, so a new song re-renders the row it left and the row it reached, and a
 * pause re-renders one — where every row used to hear every change.
 */
export function useSongPlayback(songId: number): 'playing' | 'paused' | null {
  const store = useContext(PlayerStoresContext)?.playback ?? NO_PLAYBACK
  const read = useCallback(() => songPlayback(store.get(), songId), [store, songId])
  return useSyncExternalStore(store.subscribe, read, read)
}

/** Whether this song is the loaded one, playing or paused. */
export function useIsCurrentSong(songId: number): boolean {
  return useSongPlayback(songId) !== null
}

export function usePlayer(): PlayerApi {
  const value = useContext(PlayerContext)
  if (!value) throw new Error('usePlayer must be used inside a PlayerProvider')
  return value
}
