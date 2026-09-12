import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AppState } from 'react-native'
import { useQueryClient } from '@tanstack/react-query'
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
import { useLibrary, useServerSettings } from '../api/queries'
import { useDownloads } from '../offline/DownloadsProvider'
import { flushListens, recordListen } from '../offline/listenOutbox'
import { useConnection } from '../server/ConnectionProvider'
import { ensurePlayer } from './setup'
import { songIdOf, toTrack, type SongTrack } from './tracks'

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
  /** Start these songs here; `shuffle` sets the mode first, else it is kept. */
  playFrom: (songIds: readonly number[], startIndex: number, shuffle?: boolean) => void
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

/**
 * Fraction of a track that must be heard before it counts, until the Mac says
 * otherwise. It is a setting the person chooses, and the web app honours it —
 * a phone quietly keeping its own number means the same listening is counted
 * differently depending on which device was in your hand. This is only the
 * fallback for before the setting has been read, and matches its default.
 */
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
  const { data: serverSettings } = useServerSettings()

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
  const thresholdRef = useRef(PLAY_THRESHOLD)
  const trackingRef = useRef<PlayTracking>({ songId: null, listenedSeconds: 0, counted: false })
  /** Queue loads still being handed to the native player. See `loadQueue`. */
  const loadsInFlightRef = useRef(0)

  /** Take the native player's word for which track is active. */
  const syncIndex = useCallback((index: number | undefined) => {
    if (index === undefined) return
    setQueue(state => (state.index === index ? state : { ...state, index }))
  }, [])

  useEffect(() => {
    queueRef.current = queue
  }, [queue])

  useEffect(() => {
    songsRef.current = songsById
  }, [songsById])

  useEffect(() => {
    thresholdRef.current = serverSettings?.playThreshold ?? PLAY_THRESHOLD
  }, [serverSettings?.playThreshold])

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
    if (songId === null || tracking.counted) return

    const song = songsRef.current.get(songId)
    const needed = Math.min(
      (song?.duration ?? 0) * thresholdRef.current,
      PLAY_THRESHOLD_CAP_SECONDS,
    )
    if (!completed && tracking.listenedSeconds < needed) return

    tracking.counted = true
    // Kept on the phone first: with the Mac asleep it goes when the Mac wakes.
    recordListen(songId, Math.round(tracking.listenedSeconds * 1000), completed)
  }, [])

  // Plays made offline go the moment there is a server to send them to, and
  // again each time the app comes back to the foreground — the phone's nearest
  // thing to "the Mac might be awake now". Counts on screen refresh after.
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

        // While a queue is being loaded the native side reports every step
        // of the way — nothing, then track 0, then the one that was asked for
        // — and `loadQueue` reconciles once at the end instead. Outside a
        // load the update is functional, against the state React actually
        // holds: compared against the ref, a stale mirror of that state, the
        // second of two quick events was once dropped because the ref still
        // agreed with it, and the phone settled on the wrong song.
        if (loadsInFlightRef.current === 0) syncIndex(event.index)
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
      // No Mac is not a reason to play nothing any more: a song downloaded
      // from the bucket plays from this device's own disk. What is dropped is
      // a song with neither — nothing to play it from — rather than the whole
      // queue.
      const server = connectionRef.current
      return songIds
        .map(id => songsRef.current.get(id))
        .filter((song): song is Song => song !== undefined)
        .map(song => toTrack(song, server, downloadQueue.localUri(song.id)))
        .filter((track): track is SongTrack => track !== null)
    },
    [downloadQueue],
  )

  const loadQueue = useCallback(
    (requested: QueueState, autoplay: boolean) => {
      loadsInFlightRef.current += 1
      void (async () => {
        try {
          await ensurePlayer()
          setReady(true)
          const tracks = buildTracks(requested.items)
          if (tracks.length === 0) {
            await TrackPlayer.reset()
            return
          }

          // A song with nothing to play it from is left out of the native
          // queue, so the pure queue drops it too: the two must stay the same
          // length, or the index the native side reports names the wrong song.
          let state = requested
          if (tracks.length !== requested.items.length) {
            const items = tracks.map(track => track.songId)
            const wanted = requested.items[requested.index]
            const at = wanted === undefined ? -1 : items.indexOf(wanted)
            state = { ...requested, items, index: Math.max(0, Math.min(at, items.length - 1)) }
            setQueue(state)
          }

          await TrackPlayer.setQueue(tracks)
          await TrackPlayer.setRepeatMode(REPEAT_MODES[state.repeat])
          if (state.index > 0) await TrackPlayer.skip(state.index)
          if (autoplay) await TrackPlayer.play()
        } catch (error) {
          console.warn('could not load the queue', error)
        } finally {
          loadsInFlightRef.current -= 1
        }
        // The events that arrived during the load were ignored; ask once now.
        if (loadsInFlightRef.current === 0) {
          syncIndex(await TrackPlayer.getActiveTrackIndex().catch(() => undefined))
        }
      })()
    },
    [buildTracks, syncIndex],
  )

  /*
   * Re-resolve the native queue when a download finishes: the track that was
   * streaming should switch to the local file next time it is played.
   *
   * Keyed on which of the *queued* songs are held locally, rather than on the
   * download index itself. Finishing a download changes that index whatever
   * was downloaded, and tearing the upcoming queue down and building it again
   * for a song that is not in it achieves nothing — during a sync of a few
   * hundred songs, a few hundred times over.
   */
  const downloadedEntries = downloads.index.entries
  const queuedAndHeld = queue.items.filter(id => String(id) in downloadedEntries).join(',')
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
  }, [queuedAndHeld, buildTracks])

  // --- commands ------------------------------------------------------------

  const play = useCallback(
    (songIds: readonly number[], startIndex: number, shuffle?: boolean) => {
      // "Play" on a list means in order, as on the web; a tapped row keeps
      // whatever mode is on.
      const from = shuffle === undefined ? queueRef.current : { ...queueRef.current, shuffle }
      const next = playFrom(from, songIds, startIndex)
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
      if (state.state === State.Playing || state.state === State.Buffering)
        await TrackPlayer.pause()
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
