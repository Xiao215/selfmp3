import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AppState } from 'react-native'
import { useQueryClient } from '@tanstack/react-query'
import {
  advance,
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
import { listenedDelta, secondsToCount, type EngineState } from '@selfmp3/client'
import { mediaUrlFor } from '../api/client'
import { prefs } from '../ports/prefs'
import { useLibrary, useServerSettings } from '../api/queries'
import { useDownloads } from '../offline/DownloadsProvider'
import { flushListens, recordListen } from '../offline/listenOutbox'
import { createEngine } from '../ports/engine'
import { useConnection } from '../server/ConnectionProvider'

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
  readonly position: number
  readonly duration: number
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
  ) => void
  playShuffled: (songIds: readonly number[]) => void
  jumpTo: (index: number) => void
  toggle: () => void
  next: () => void
  previous: () => void
  seekTo: (seconds: number) => void
  toggleShuffle: () => void
  cycleRepeatMode: () => void
  playNext: (songIds: readonly number[]) => void
  addToQueue: (songIds: readonly number[]) => void
  removeFromQueue: (index: number) => void
  reorderQueue: (from: number, to: number) => void
  /** 0–1, as the engine has it; the bar's slider and the web's share one scale. */
  readonly volume: number
  readonly muted: boolean
  /** Playback speed: 1 is normal. */
  readonly rate: number
  /** Waiting on the network mid-song, which shows differently from paused. */
  readonly stalled: boolean
  /** When the sleep timer stops playback, or null when none is set. */
  readonly sleepTimerEndsAt: number | null
  setVolume: (volume: number) => void
  toggleMute: () => void
  setRate: (rate: number) => void
  /** Minutes from now, or null to cancel. */
  setSleepTimer: (minutes: number | null) => void
}

/** Where this device keeps its volume, as the web app does. */
const VOLUME_KEY = 'volume'

const PlayerContext = createContext<PlayerApi | null>(null)

/**
 * Fraction of a track that must be heard before it counts, until the Mac says
 * otherwise. It is a setting the person chooses, and the web app honours it —
 * a phone quietly keeping its own number means the same listening is counted
 * differently depending on which device was in your hand.
 */
const PLAY_THRESHOLD = 0.5

interface PlayTracking {
  songId: number | null
  listenedSeconds: number
  counted: boolean
}

export function PlayerProvider({ children }: { children: ReactNode }): ReactNode {
  const { connection } = useConnection()
  const library = useLibrary()
  const { queue: downloadQueue } = useDownloads()
  const { data: serverSettings } = useServerSettings()

  // Built once and kept: an engine outlives every render, and rebuilding it
  // would mean dropping the audio that is playing. Its wiring is handed over
  // with `connect` rather than assigned, which is the same point made in the
  // port.
  const [engine] = useState(createEngine)
  const [queue, setQueue] = useState<QueueState>(EMPTY_QUEUE)
  const [engineState, setEngineState] = useState<EngineState>(() => engine.state)
  const [sleepTimerEndsAt, setSleepTimerEndsAt] = useState<number | null>(null)

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
  const thresholdRef = useRef(PLAY_THRESHOLD)
  const trackingRef = useRef<PlayTracking>({ songId: null, listenedSeconds: 0, counted: false })
  const lastPositionRef = useRef(0)

  useEffect(() => {
    queueRef.current = queue
  }, [queue])
  useEffect(() => {
    songsRef.current = songsById
  }, [songsById])
  useEffect(() => {
    connectionRef.current = connection
  }, [connection])
  useEffect(() => {
    thresholdRef.current = serverSettings?.playThreshold ?? PLAY_THRESHOLD
  }, [serverSettings?.playThreshold])

  useEffect(() => engine.subscribe(setEngineState), [engine])

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

  const flushPlay = useCallback((completed: boolean) => {
    const tracking = trackingRef.current
    const songId = tracking.songId
    if (songId === null || tracking.counted) return

    const song = songsRef.current.get(songId)
    const needed = secondsToCount(song?.duration ?? 0, thresholdRef.current)
    if (!completed && tracking.listenedSeconds < needed) return

    tracking.counted = true
    // Kept on the phone first: with the Mac asleep it goes when the Mac wakes.
    recordListen(songId, Math.round(tracking.listenedSeconds * 1000), completed)
  }, [])

  const queryClient = useQueryClient()
  useEffect(() => {
    const flush = (): void => {
      void flushListens().then(sent => {
        if (sent > 0) void queryClient.invalidateQueries()
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
      nextTrackId: () => peekNext(queueRef.current),

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

        const { state, stop } = advance(queueRef.current, true)
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
  }, [engine, loadIndex, flushPlay, downloadQueue])

  // --- commands ------------------------------------------------------------

  const play = useCallback(
    (songIds: readonly number[], startIndex: number, shuffle?: boolean, position?: number) => {
      // "Play" on a list means in order, as on the web; a tapped row keeps
      // whatever mode is on.
      const from = shuffle === undefined ? queueRef.current : { ...queueRef.current, shuffle }
      const next = playFrom(from, songIds, startIndex)
      setQueue(next)
      loadIndex(next, true, position)
    },
    [loadIndex],
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
      const start = Math.floor(Math.random() * songIds.length)
      const next = playFrom({ ...queueRef.current, shuffle: true }, songIds, start)
      setQueue(next)
      loadIndex(next, true)
    },
    [loadIndex],
  )

  const jumpTo = useCallback(
    (index: number) => {
      const next = { ...queueRef.current, index }
      setQueue(next)
      loadIndex(next, true)
    },
    [loadIndex],
  )

  const toggle = useCallback(() => {
    if (engine.state.playing) engine.pause()
    else void engine.play()
  }, [engine])

  const next = useCallback(() => {
    // Pressing Next is not the song running out: `auto` false, so repeat-one
    // moves on rather than playing the same song again.
    const { state, stop } = advance(queueRef.current, false)
    if (stop) return
    setQueue(state)
    loadIndex(state, true)
  }, [loadIndex])

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
    (songIds: readonly number[]) => mutateQueue(state => enqueueIds(state, songIds)),
    [mutateQueue],
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

  const value = useMemo<PlayerApi>(
    () => ({
      queue,
      songs: resolved.queueSongs,
      current: resolved.currentSong,
      isPlaying: engineState.playing,
      position: engineState.currentTime,
      duration:
        engineState.duration > 0 ? engineState.duration : (resolved.currentSong?.duration ?? 0),
      ready: true,
      playFrom: play,
      playShuffled,
      jumpTo,
      toggle,
      next,
      previous,
      seekTo,
      toggleShuffle,
      cycleRepeatMode,
      playNext,
      addToQueue,
      removeFromQueue,
      reorderQueue,
      volume: engineState.volume,
      muted: engineState.muted,
      rate: engineState.rate,
      stalled: engineState.stalled,
      sleepTimerEndsAt,
      setVolume,
      toggleMute,
      setRate,
      setSleepTimer,
    }),
    [
      engineState.volume,
      engineState.muted,
      engineState.rate,
      engineState.stalled,
      sleepTimerEndsAt,
      setVolume,
      toggleMute,
      setRate,
      setSleepTimer,
      queue,
      resolved,
      engineState.playing,
      engineState.currentTime,
      engineState.duration,
      play,
      playShuffled,
      jumpTo,
      toggle,
      next,
      previous,
      seekTo,
      toggleShuffle,
      cycleRepeatMode,
      playNext,
      addToQueue,
      removeFromQueue,
      reorderQueue,
    ],
  )

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
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

export function usePlayer(): PlayerApi {
  const value = useContext(PlayerContext)
  if (!value) throw new Error('usePlayer must be used inside a PlayerProvider')
  return value
}
