import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import TrackPlayer, {
  Event,
  RepeatMode,
  State,
  useIsPlaying,
  useProgress,
  useTrackPlayerEvents,
} from 'react-native-track-player'
import {
  cycleRepeat,
  EMPTY_QUEUE,
  enqueue as enqueueIds,
  moveItem,
  playFrom,
  playNext as playNextIds,
  previous as previousInQueue,
  removeAt,
  resolveQueue,
  setShuffle,
  type QueueState,
  type Song,
} from '@selfmp3/shared'
import { api } from '../api/client'
import { useLibrary } from '../api/queries'
import { useDownloads } from '../offline/DownloadsProvider'
import { useConnection } from '../server/ConnectionProvider'
import { ensurePlayer } from './setup'
import { songIdOf, toTrack } from './tracks'

/**
 * The React glue, the same role `player/PlayerProvider.tsx` plays on the web.
 *
 * The split is deliberately the same as the web app's, with one piece swapped:
 *
 *   - queue rules  → `@selfmp3/shared`'s `queue.ts`, byte for byte the same
 *     pure functions the web app uses, so shuffle and "play next" behave
 *     identically on both.
 *   - the engine   → react-native-track-player, instead of two `<audio>`
 *     elements. It owns buffering, auto-advance and the lock screen, which is
 *     what makes gapless playback and background audio work at all.
 *   - this file    → state, server sync, and keeping the native queue in step
 *     with the pure one.
 *
 * `QueueState` stays the source of truth for *order*; the native player is the
 * source of truth for *position*, and reports it back through
 * `PlaybackActiveTrackChanged`. Trying to own both ends in two players
 * disagreeing about what is playing.
 */

export interface PlayerApi {
  readonly queue: QueueState
  readonly songs: readonly Song[]
  readonly current: Song | null
  readonly isPlaying: boolean
  readonly position: number
  readonly duration: number
  readonly ready: boolean
  playFrom: (songIds: readonly number[], startIndex: number) => void
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
}

const PlayerContext = createContext<PlayerApi | null>(null)

const REPEAT_MODES: Record<QueueState['repeat'], RepeatMode> = {
  off: RepeatMode.Off,
  all: RepeatMode.Queue,
  one: RepeatMode.Track,
}

/** Fraction of a track that must be heard before it counts, as on the web. */
const PLAY_THRESHOLD = 0.5
/** ...capped, so a 20-minute track is not held hostage. */
const PLAY_THRESHOLD_CAP_SECONDS = 240

interface PlayTracking {
  songId: number | null
  listenedSeconds: number
  counted: boolean
}

export function PlayerProvider({ children }: { children: ReactNode }): ReactNode {
  const { connection } = useConnection()
  const library = useLibrary()
  const { state: downloads, queue: downloadQueue } = useDownloads()

  const [queue, setQueue] = useState<QueueState>(EMPTY_QUEUE)
  const [ready, setReady] = useState(false)

  const songsById = useMemo(() => {
    const map = new Map<number, Song>()
    for (const song of library.data?.songs ?? []) map.set(song.id, song)
    return map
  }, [library.data])

  // Refs so the native event listeners always see current values without
  // being torn down and re-subscribed on every render. They are written in
  // effects rather than during render, which is both the rule and the honest
  // description of what they are: a mirror kept in step after each commit.
  const queueRef = useRef(queue)
  const songsRef = useRef(songsById)
  const connectionRef = useRef(connection)
  const trackingRef = useRef<PlayTracking>({ songId: null, listenedSeconds: 0, counted: false })

  useEffect(() => {
    queueRef.current = queue
  }, [queue])

  useEffect(() => {
    songsRef.current = songsById
  }, [songsById])

  useEffect(() => {
    connectionRef.current = connection
  }, [connection])

  const progress = useProgress(500)
  const { playing } = useIsPlaying()

  useEffect(() => {
    let cancelled = false
    void ensurePlayer()
      .then(() => {
        if (!cancelled) setReady(true)
      })
      .catch(() => {
        // Backgrounded on Android is the usual cause; the next play attempt
        // calls ensurePlayer() again.
        if (!cancelled) setReady(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // --- play reporting ------------------------------------------------------

  const flushPlay = useCallback((completed: boolean) => {
    const tracking = trackingRef.current
    const songId = tracking.songId
    const server = connectionRef.current
    if (songId === null || server === null || tracking.counted) return

    const song = songsRef.current.get(songId)
    const needed = Math.min((song?.duration ?? 0) * PLAY_THRESHOLD, PLAY_THRESHOLD_CAP_SECONDS)
    if (!completed && tracking.listenedSeconds < needed) return

    tracking.counted = true
    void api
      .recordPlay(server, songId, {
        msPlayed: Math.round(tracking.listenedSeconds * 1000),
        completed,
      })
      .catch(() => undefined)
  }, [])

  // Accumulate listening time. `useProgress` polls, so the delta is derived
  // from the reported position rather than from a wall clock, which keeps
  // seeking from inflating the count.
  const lastPositionRef = useRef(0)
  useEffect(() => {
    const tracking = trackingRef.current
    const delta = progress.position - lastPositionRef.current
    lastPositionRef.current = progress.position
    if (playing === true && delta > 0 && delta < 2) tracking.listenedSeconds += delta
    if (!tracking.counted) flushPlay(false)
  }, [progress.position, playing, flushPlay])

  // --- native → pure state -------------------------------------------------

  useTrackPlayerEvents(
    [Event.PlaybackActiveTrackChanged, Event.PlaybackQueueEnded, Event.PlaybackError],
    event => {
      if (event.type === Event.PlaybackActiveTrackChanged) {
        const finishedId = songIdOf(event.lastTrack)
        if (finishedId !== null) {
          const finished = songsRef.current.get(finishedId)
          const ranOut =
            finished !== undefined &&
            finished.duration > 0 &&
            event.lastPosition >= finished.duration - 2
          flushPlay(ranOut)
        }

        trackingRef.current = { songId: songIdOf(event.track), listenedSeconds: 0, counted: false }
        lastPositionRef.current = 0

        if (event.index !== undefined && event.index !== queueRef.current.index) {
          setQueue(state => ({ ...state, index: event.index ?? state.index }))
        }
        return
      }

      if (event.type === Event.PlaybackQueueEnded) {
        flushPlay(true)
        return
      }

      // A playback error on one track should not wedge the queue.
      console.warn(`playback error (${event.code}): ${event.message}`)
    },
  )

  // --- pure state → native -------------------------------------------------

  const buildTracks = useCallback(
    (songIds: readonly number[]) => {
      const server = connectionRef.current
      if (!server) return []
      return songIds
        .map(id => songsRef.current.get(id))
        .filter((song): song is Song => song !== undefined)
        .map(song => toTrack(song, server, downloadQueue.localUri(song.id)))
    },
    [downloadQueue],
  )

  const loadQueue = useCallback(
    (state: QueueState, autoplay: boolean) => {
      void (async () => {
        try {
          await ensurePlayer()
          setReady(true)
          const tracks = buildTracks(state.items)
          if (tracks.length === 0) {
            await TrackPlayer.reset()
            return
          }
          await TrackPlayer.setQueue(tracks)
          await TrackPlayer.setRepeatMode(REPEAT_MODES[state.repeat])
          if (state.index > 0) await TrackPlayer.skip(state.index)
          if (autoplay) await TrackPlayer.play()
        } catch (error) {
          console.warn('could not load the queue', error)
        }
      })()
    },
    [buildTracks],
  )

  // Re-resolve the native queue when a download finishes: the track that was
  // streaming should switch to the local file next time it is played.
  const downloadedEntries = downloads.index.entries
  useEffect(() => {
    if (queueRef.current.items.length === 0) return
    // Only the *upcoming* tracks are worth rewriting; replacing the active one
    // would restart it mid-song.
    void (async () => {
      try {
        const active = await TrackPlayer.getActiveTrackIndex()
        if (active === undefined) return
        const upcoming = queueRef.current.items.slice(active + 1)
        if (upcoming.length === 0) return
        await TrackPlayer.removeUpcomingTracks()
        await TrackPlayer.add(buildTracks(upcoming))
      } catch {
        // Nothing loaded yet; the next play builds fresh tracks anyway.
      }
    })()
  }, [downloadedEntries, buildTracks])

  // --- commands ------------------------------------------------------------

  const play = useCallback(
    (songIds: readonly number[], startIndex: number) => {
      const next = playFrom(queueRef.current, songIds, startIndex)
      setQueue(next)
      loadQueue(next, true)
    },
    [loadQueue],
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
      loadQueue(next, true)
    },
    [loadQueue],
  )

  const jumpTo = useCallback((index: number) => {
    setQueue(state => ({ ...state, index }))
    void TrackPlayer.skip(index).then(() => TrackPlayer.play())
  }, [])

  const toggle = useCallback(() => {
    void (async () => {
      const state = await TrackPlayer.getPlaybackState()
      if (state.state === State.Playing || state.state === State.Buffering) await TrackPlayer.pause()
      else await TrackPlayer.play()
    })()
  }, [])

  const next = useCallback(() => {
    void TrackPlayer.skipToNext().catch(() => undefined)
  }, [])

  const previous = useCallback(() => {
    // Match the web: within the first few seconds "previous" means the
    // previous track, after that it means "start this one again".
    void (async () => {
      const { position } = await TrackPlayer.getProgress()
      if (position > 3) {
        await TrackPlayer.seekTo(0)
        return
      }
      const state = previousInQueue(queueRef.current)
      if (state === queueRef.current) {
        await TrackPlayer.seekTo(0)
        return
      }
      setQueue(state)
      await TrackPlayer.skipToPrevious()
    })()
  }, [])

  const seekTo = useCallback((seconds: number) => {
    void TrackPlayer.seekTo(seconds)
  }, [])

  const toggleShuffle = useCallback(() => {
    void (async () => {
      // Toggling shuffle should not start playback that was paused, so the
      // current state decides whether the reloaded queue autoplays.
      const state = await TrackPlayer.getPlaybackState()
      const wasPlaying = state.state === State.Playing || state.state === State.Buffering
      const next = setShuffle(queueRef.current, !queueRef.current.shuffle)
      setQueue(next)
      // The order changed under the player, so the native queue is rebuilt
      // with the current track first — reloading it keeps them in step.
      loadQueue(next, wasPlaying)
    })()
  }, [loadQueue])

  const cycleRepeatMode = useCallback(() => {
    const repeat = cycleRepeat(queueRef.current.repeat)
    setQueue(state => ({ ...state, repeat }))
    void TrackPlayer.setRepeatMode(REPEAT_MODES[repeat])
  }, [])

  const playNext = useCallback(
    (songIds: readonly number[]) => {
      const next = playNextIds(queueRef.current, songIds)
      setQueue(next)
      loadQueue(next, false)
    },
    [loadQueue],
  )

  const addToQueue = useCallback(
    (songIds: readonly number[]) => {
      const next = enqueueIds(queueRef.current, songIds)
      setQueue(next)
      loadQueue(next, false)
    },
    [loadQueue],
  )

  const removeFromQueue = useCallback(
    (index: number) => {
      const next = removeAt(queueRef.current, index)
      setQueue(next)
      loadQueue(next, false)
    },
    [loadQueue],
  )

  const reorderQueue = useCallback(
    (from: number, to: number) => {
      const next = moveItem(queueRef.current, from, to)
      setQueue(next)
      loadQueue(next, false)
    },
    [loadQueue],
  )

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
      isPlaying: playing === true,
      position: progress.position,
      duration: progress.duration > 0 ? progress.duration : (resolved.currentSong?.duration ?? 0),
      ready,
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
    }),
    [
      queue,
      resolved,
      playing,
      progress.position,
      progress.duration,
      ready,
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

export function usePlayer(): PlayerApi {
  const value = useContext(PlayerContext)
  if (!value) throw new Error('usePlayer must be used inside a PlayerProvider')
  return value
}
