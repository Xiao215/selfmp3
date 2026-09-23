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
import {
  cycleRepeat,
  EMPTY_QUEUE,
  enqueue as enqueueIds,
  moveItem,
  peekNext,
  playFrom,
  insertAt as insertAtIndex,
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
  type FrequencyAnalyser,
  listenedDelta,
  peekPlayable,
  recoverPlayback,
  useLibrary,
  useSameArray,
  useSettings,
} from '@selfmp3/client'
import { mediaUrlFor } from '../api/client'
import {
  artAddress,
  serverRoutes,
  streamAddress,
  streamHeaders,
  type MediaSources,
} from '../api/mediaAddress.model'
import { bucketMedia, configureBucketMedia } from '../ports/bucketMedia'
import { prefs } from '../ports/prefs'
import { recentUri } from '../ports/recentCopies'
import { session as cloudSession } from '../replica'
import { coverFor, coversVersion, KEPT_COVER_SIZE, subscribeCovers } from '../offline/covers'
import { useDownloads } from '../offline/DownloadsProvider'
import { createEngine } from '../ports/engine'
import { usePracticeControls } from './usePracticeControls'
import { useSleepTimer } from './useSleepTimer'
import { usePlayReporting } from './usePlayReporting'
import { useConnection } from '../connection/ConnectionProvider'
import { showToast } from '../ui/toast'
import { nowPlayingArtwork, type ArtSources } from './nowPlayingArt.model'
import { handleRemoteCommands } from './remoteCommands'
import { useNowPlaying } from './useNowPlaying'
import {
  createProgressStore,
  createValueStore,
  differsBesidesClock,
  samePlayback,
  samePractice,
  sameVolume,
  songPlayback,
  type PlayerProgress,
  type PracticeState,
  type ProgressStore,
  type SongPlaybackState,
  type ValueStore,
  type VolumeState,
} from './progress.model'

export type { PlayerProgress }

/**
 * The React glue between the queue rules and whatever makes a sound.
 *
 * It is written against `PlaybackEngine`, so it drives whichever engine this
 * platform has the same way. `QueueState` is the only source of truth for
 * order *and* position; the engine plays the song it is handed and says when
 * that song ended. On the phone `engine.ts` keeps one song queued behind the
 * current one so the handover stays gapless and the lock screen has a Next to
 * offer — which is the engine's business, not this file's.
 *
 * What is still the phone's here: the listen outbox flushing when the app
 * comes back to the foreground, which is a phone's nearest thing to "the server
 * might be awake now".
 */

export interface PlayerApi {
  readonly queue: QueueState
  readonly songs: readonly Song[]
  readonly current: Song | null
  readonly isPlaying: boolean
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
  /**
   * The playhead from the engine itself, between progress ticks: for a drawing
   * that moves on the beat. Read it in an animation frame, never in a render.
   */
  getPlayhead: () => number
  /**
   * The live sound, where this engine can tap it (a browser's Web Audio); null
   * on a phone. Asking routes playback through Web Audio for good, so a visual
   * asks only where that is safe (`ports/liveAudio`).
   */
  analyser: () => FrequencyAnalyser | null
  toggleShuffle: () => void
  cycleRepeatMode: () => void
  playNext: (songIds: readonly number[]) => void
  addToQueue: (songIds: readonly number[]) => void
  removeFromQueue: (index: number) => void
  reorderQueue: (from: number, to: number) => void
  /** Put songs at one place in the queue: where a drag let go of them. */
  insertIntoQueue: (at: number, songIds: readonly number[]) => void
  /** Empty the queue and stop, as the web's bin in Up next does. */
  clearQueue: () => void
  /** When the sleep timer stops playback, or null when none is set. */
  readonly sleepTimerEndsAt: number | null
  /** The sleep timer waits for the song playing to end, rather than a clock. */
  readonly sleepAtSongEnd: boolean
  /** The level itself is `usePlayerVolume()`'s: it moves too often to ride here. */
  setVolume: (volume: number) => void
  /** Up or down by one step from where the level is now. */
  stepVolume: (delta: number) => void
  toggleMute: () => void
  setRate: (rate: number) => void
  /**
   * Minutes from now; `song-end` to stop when the song playing now ends (the
   * first track end after choosing, whichever song that turns out to be); or
   * null to cancel either.
   */
  setSleepTimer: (choice: number | 'song-end' | null) => void

  // --- auto-mix ------------------------------------------------------------
  /** Upcoming songs kept in a smooth order by tempo, key and energy. */
  readonly autoMix: boolean
  /** Whether this engine fades one song into the next; a phone's cannot. */
  readonly canCrossfade: boolean
  /** The fade into the next song: auto-mix's pick, or the server's setting. */
  readonly nextCrossfadeSeconds: number
  setAutoMix: (on: boolean) => void

  // --- practice ------------------------------------------------------------
  // The loop, the speed and the count-in as they stand are `usePracticeState()`'s.
  /** Whether this engine can loop A to B closely; a phone's cannot, yet. */
  readonly canLoop: boolean
  /** Whether a restart of the loop waits one beat first. */
  readonly countIn: boolean
  /** Set A or B of the loop from where the song is now. */
  tapLoopPoint: (which: 'A' | 'B') => void
  clearLoop: () => void
  setPreservesPitch: (on: boolean) => void
  setCountIn: (on: boolean) => void
}

/** Practice preferences, kept on this device. */
const AUTO_MIX_KEY = 'automix'

const PlayerContext = createContext<PlayerApi | null>(null)

/**
 * The facts that move too often, or matter to too few, to ride in `PlayerApi`.
 *
 * Made once per provider and never replaced, so this context itself never
 * changes; each hook below subscribes to the one store it reads. `stalled`
 * lives here rather than in `PlayerApi` because every waiting/playing pair
 * from the network would otherwise re-render every screen and row that asks
 * for the player; the volume, because a drag of the slider sets it on every
 * frame; the practice state, because a count-in flips on each loop restart.
 */
interface PlayerStores {
  readonly progress: ProgressStore
  readonly playback: ValueStore<SongPlaybackState>
  readonly stalled: ValueStore<boolean>
  readonly volume: ValueStore<VolumeState>
  readonly practice: ValueStore<PracticeState>
}

const PlayerStoresContext = createContext<PlayerStores | null>(null)

export function PlayerProvider({ children }: { children: ReactNode }): ReactNode {
  const { connection, fromCloud } = useConnection()
  const library = useLibrary()
  const { queue: downloadQueue, checkPlay, mayPlay, keepPlayed } = useDownloads()
  const { data: serverSettings } = useSettings()

  // Built once and kept: an engine outlives every render, and rebuilding it
  // would mean dropping the audio that is playing. Its wiring is handed over
  // with `connect` rather than assigned, which is the same point made in the
  // port.
  const [engine] = useState(createEngine)
  const [queue, setQueue] = useState<QueueState>(EMPTY_QUEUE)
  const [engineState, setEngineState] = useState<EngineState>(() => engine.state)
  const [autoMix, setAutoMixState] = useState(() => prefs.get(AUTO_MIX_KEY) === '1')
  const [stores] = useState<PlayerStores>(() => ({
    progress: createProgressStore(),
    playback: createValueStore<SongPlaybackState>({ songId: null, playing: false }, samePlayback),
    stalled: createValueStore(false),
    volume: createValueStore(volumeOf(engine.state), sameVolume),
    practice: createValueStore(practiceOf(engine.state), samePractice),
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
  const fromCloudRef = useRef(fromCloud)
  const lastPositionRef = useRef(0)
  const autoMixRef = useRef(autoMix)
  // Read by the engine's end-of-track callback, which is wired once.
  // Told every engine state; set once the commands it needs exist, below.
  const playbackErrorRef = useRef<(state: EngineState) => void>(() => undefined)

  /*
   * The one way the queue changes: the ref first, then the state.
   *
   * The ref is what every command and every engine callback reads, and it has
   * to be right the moment a command returns, not after the render that
   * follows. It used to be filled in by an effect, so two commands in one tick
   * — a headset's double-tap sending Next twice, a drop into Up next calling
   * `next()` and then `addToQueue` — both read the queue from before the first,
   * and the phone's lookahead, asked for the next song straight after a skip,
   * was told the song that had just been left. State still renders what is
   * shown; the ref is the source of truth for what happens next.
   */
  const commitQueue = useCallback((next: QueueState) => {
    queueRef.current = next
    setQueue(next)
  }, [])

  useEffect(() => {
    songsRef.current = songsById
  }, [songsById])
  useEffect(() => {
    autoMixRef.current = autoMix
  }, [autoMix])

  /*
   * What a phone needs to stream a bucket song: each song's key there, and the
   * doorman session to ask with (ports/bucketMedia.ts; nothing, in a browser,
   * whose service worker looks both up for itself). The library is read through
   * the ref, so a song imported a moment ago has an address without this
   * running again; the session is read when the library becomes the bucket's,
   * which is the moment sign-in finishes.
   */
  useEffect(() => {
    if (!fromCloud) {
      configureBucketMedia(null)
      return
    }
    let cancelled = false
    void cloudSession
      .loadSession()
      .catch(() => null)
      .then(signedIn => {
        if (cancelled) return
        configureBucketMedia({
          pathOf: songId => songsRef.current.get(songId)?.path ?? null,
          bearer: signedIn?.token ?? null,
        })
      })
    return () => {
      cancelled = true
      configureBucketMedia(null)
    }
  }, [fromCloud])

  /** With auto-mix on, anything that brings new songs into Up next re-smooths it. */
  const mixed = useCallback(
    (state: QueueState): QueueState =>
      autoMixRef.current ? autoMixOrder(state, songsRef.current) : state,
    [],
  )
  useEffect(() => {
    connectionRef.current = connection
    fromCloudRef.current = fromCloud
  }, [connection, fromCloud])

  /*
   * The clock to its store, everything else to state.
   *
   * `setEngineState` keeps the previous object when only the clock moved, and
   * React skips a render for a state set to what it already is — so a tick no
   * longer renders this provider at all, and only what subscribes to the
   * progress store (the scrubbers, the synced lyrics) hears it.
   */
  useEffect(() => {
    /*
     * A stall has to last before anyone is told about it.
     *
     * The two engines mean different things by the word. A browser's `waiting`
     * fires when it has actually run dry, so it is always worth showing; the
     * phone's player reports Loading or Buffering every time it takes a track,
     * including one already on the disk that is ready in a blink. Told
     * straight through, the phone flashed a spinner on every press of play —
     * one tap, four changes of glyph (Xiao, 2026-09-27). A stall that clears
     * inside the grace was never worth drawing; one that outlasts it is the
     * one the spinner is for, and clearing is always told at once.
     */
    let waiting: ReturnType<typeof setTimeout> | null = null
    const forget = (): void => {
      if (waiting === null) return
      clearTimeout(waiting)
      waiting = null
    }
    const stop = engine.subscribe(state => {
      // Tagged with the song the engine is timing, so a tick the song being
      // left still had in it is not drawn as the new song's position.
      stores.progress.set(engine.currentSongId, state.currentTime, state.duration)
      stores.volume.set(volumeOf(state))
      stores.practice.set(practiceOf(state))
      if (!state.stalled) {
        forget()
        stores.stalled.set(false)
      } else if (waiting === null && !stores.stalled.get()) {
        waiting = setTimeout(() => {
          waiting = null
          stores.stalled.set(true)
        }, STALL_SHOWS_AFTER_MS)
      }
      playbackErrorRef.current(state)
      setEngineState(previous => (differsBesidesClock(previous, state) ? state : previous))
    })
    return () => {
      forget()
      stop()
    }
  }, [engine, stores])

  useEffect(() => () => engine.destroy(), [engine])

  /*
   * Practice, volume and speed: a line or two each over the engine, with the
   * preference this device remembers them by. The seams below — reporting a
   * play, wiring the engine, the commands — stay here, because each holds a
   * dozen refs the others read; pulled apart they would take a dozen
   * arguments, which is a worse seam than a long function.
   */
  const practice = usePracticeControls(engine)
  const { countIn } = practice
  const sleep = useSleepTimer(engine)

  /*
   * Counting a play and sending what this device kept: `usePlayReporting`.
   * The tracking ref stays here, because the engine's callbacks below write
   * to it as the song runs.
   */
  const { tracking: trackingRef, flushPlay } = usePlayReporting({
    songs: songsRef,
    keepPlayed,
    connection,
  })

  // --- engine wiring -------------------------------------------------------

  const loadIndex = useCallback(
    (state: QueueState, autoplay: boolean, startAt?: number) => {
      const songId = state.items[state.index]
      if (songId === undefined) return
      trackingRef.current = { songId, listenedSeconds: 0, counted: false }
      // Starting part-way is not listening to the part skipped.
      lastPositionRef.current = startAt ?? 0
      // The clock is this song's from here, not from the engine's first tick
      // for it — which on a phone is up to a second away. `startAt` goes
      // through as it came: without one, asking again for the song already
      // playing leaves its clock alone rather than sending it back to 0:00.
      stores.progress.follow(songId, startAt)
      void engine.load(songId, startAt ? { autoplay, startAt } : { autoplay })
    },
    [engine, stores, trackingRef],
  )

  // Everywhere a song's bytes might come from, on this device, right now.
  const sourcesFor = useCallback(
    (songId: number): MediaSources => ({
      // A file here wins whenever there is one — a download first, then a copy
      // kept because it was played. It is the only thing that plays with no
      // signal, and it is the same song either way.
      // With the song's own rev, so a file kept under a reused id is not
      // played as the song that id now names (`entryIsCurrent`).
      local: downloadQueue.localUri(songId, songsRef.current.get(songId)?.rev) ?? recentUri(songId),
      ...mediaSources(connectionRef.current, fromCloudRef.current),
    }),
    [downloadQueue],
  )

  useEffect(() => {
    return engine.connect({
      // Past songs that cannot play here, so a lookahead never preloads one.
      nextTrackId: () => peekPlayable(queueRef.current, mayPlay),

      streamUrl: songId =>
        streamAddress(songId, songsRef.current.get(songId)?.rev, sourcesFor(songId)),
      // Decided by the same rule over the same sources, so an address and what
      // has to be sent with it can never come from two different places.
      streamHeaders: songId => streamHeaders(sourcesFor(songId)),

      trackMetadata: songId => {
        const song = songsRef.current.get(songId)
        if (!song) return null
        // The lock screen's cover: the copy on this device, read now rather than
        // from a render, since this is asked when the player takes the song.
        // One kept later reaches the card through `refreshNowPlaying`, below.
        const artwork = nowPlayingArtwork(
          song,
          artSources(coverFor(songId), connectionRef.current, fromCloudRef.current),
        )
        return {
          title: song.title,
          artist: song.artist,
          album: song.album,
          ...(artwork ? { artwork } : {}),
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

        // "End of this song": used up by the first song to end after it was
        // chosen, whichever that is — skipping ahead meanwhile moves the stop
        // with you rather than cancelling it.
        const sleeping = sleep.atSongEndRef.current
        if (sleeping) sleep.songEnded()

        // Past songs that cannot play here: one not on this device, offline,
        // would otherwise load and sit paused with no word.
        const ended = queueRef.current
        const { state, stop } = advancePlayable(ended, true, mayPlay)
        if (stop) {
          engine.pause()
          return
        }

        if (sleeping) {
          // Stopped, with the next song waiting at its start: play tomorrow
          // carries on from where the night left off rather than replaying the
          // end of the last one.
          engine.pause()
          commitQueue(state)
          loadIndex(state, false)
          return
        }

        commitQueue(state)
        // Repeat-one leaves the index alone, so say explicitly to start again.
        // Compared with the queue the song ended in: the ref is already the
        // new one, and against itself the index would always match.
        if (state.index === ended.index && state.repeat === 'one') {
          engine.seek(0)
          void engine.play()
          const again = state.items[state.index] ?? null
          trackingRef.current = {
            songId: again,
            listenedSeconds: 0,
            counted: false,
          }
          lastPositionRef.current = 0
          // Back to the top now, rather than showing the end of the song for
          // the tick it takes the player to report that it went back.
          stores.progress.follow(again, 0)
        } else {
          loadIndex(state, true)
        }
      },
    })
  }, [
    engine,
    loadIndex,
    flushPlay,
    downloadQueue,
    mayPlay,
    sourcesFor,
    stores,
    sleep,
    trackingRef,
    commitQueue,
  ])

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
        // "Play" on a list means in order; a tapped row keeps whatever mode is
        // on.
        const from = shuffle === undefined ? queueRef.current : { ...queueRef.current, shuffle }
        const next = mixed(playFrom(from, songIds, startIndex))
        commitQueue(next)
        loadIndex(next, autoplay, position)
      }
      // A song that cannot play here says why, rather than loading and sitting
      // paused; one that needs a yes (mobile data) starts once it has one.
      const songId = songIds[startIndex]
      if (songId !== undefined && !checkPlay(songId, start)) return
      start()
    },
    [loadIndex, checkPlay, mixed, commitQueue],
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
        commitQueue(next)
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
    [loadIndex, checkPlay, mayPlay, commitQueue],
  )

  const jumpTo = useCallback(
    (index: number) => {
      const go = (): void => {
        const next = { ...queueRef.current, index }
        commitQueue(next)
        loadIndex(next, true)
      }
      const songId = queueRef.current.items[index]
      if (songId !== undefined && !checkPlay(songId, go)) return
      go()
    },
    [loadIndex, checkPlay, commitQueue],
  )

  const toggle = useCallback(() => {
    if (engine.state.playing) engine.pause()
    else void engine.play()
  }, [engine])

  /*
   * Next and Previous change the song, never whether it is playing: paused,
   * they land on the new song paused, the way a restart already did. They used
   * to start the new song regardless, so Previous left a paused player paused
   * or set it playing depending only on whether it was past three seconds.
   */
  const next = useCallback(() => {
    // Pressing Next is not the song running out: `auto` false, so repeat-one
    // moves on rather than playing the same song again.
    const { state, stop } = advancePlayable(queueRef.current, false, mayPlay)
    if (stop) return
    commitQueue(state)
    loadIndex(state, engine.state.playing)
  }, [engine, loadIndex, mayPlay, commitQueue])

  const previous = useCallback(() => {
    // Within the first few seconds "previous" means the previous track, after
    // that it means "start this one again".
    if (engine.playhead > 3) {
      engine.seek(0)
      return
    }
    const state = previousInQueue(queueRef.current)
    if (state === queueRef.current) {
      engine.seek(0)
      return
    }
    commitQueue(state)
    loadIndex(state, engine.state.playing)
  }, [engine, loadIndex, commitQueue])

  // The lock screen's and the headphones' Next and Previous, as these buttons.
  useEffect(
    () => handleRemoteCommands(command => (command === 'next' ? next() : previous())),
    [next, previous],
  )

  /*
   * A song that stops with an error: tried again, then skipped, then stopped,
   * and each said on screen (recoverPlayback). Nothing read the engine's error
   * before — a dropped connection ended the music without a word.
   */
  const recoveryRef = useRef({
    lastError: null as string | null,
    retriedSongId: null as number | null,
    retriedFrom: 0,
    skippedInARow: 0,
  })
  useEffect(() => {
    playbackErrorRef.current = state => {
      const recovery = recoveryRef.current
      const songId = queueRef.current.items[queueRef.current.index]

      // Playing on well past where it failed: that song, and the run, are fine again.
      const from = songId === recovery.retriedSongId ? recovery.retriedFrom : 0
      if (state.playing && state.error === null && state.currentTime > from + 10) {
        recovery.retriedSongId = null
        recovery.skippedInARow = 0
      }

      // Each load clears the error first, so a second failure is a change too.
      const failed = state.error !== null && state.error !== recovery.lastError
      recovery.lastError = state.error
      if (!failed || songId === undefined) return

      const title = songsRef.current.get(songId)?.title ?? 'this song'
      const recovering = recoverPlayback({
        songId,
        retriedSongId: recovery.retriedSongId,
        skippedInARow: recovery.skippedInARow,
        hasNext: peekPlayable(queueRef.current, mayPlay) !== null,
      })
      if (recovering === 'retry') {
        // From where it stopped. Asking again also finds a copy downloaded since.
        const at = lastPositionRef.current
        recovery.retriedSongId = songId
        recovery.retriedFrom = at
        void engine.load(songId, at > 0 ? { autoplay: true, startAt: at } : { autoplay: true })
        return
      }
      if (recovering === 'skip') {
        recovery.skippedInARow += 1
        showToast(`Skipped “${title}”: ${state.error}`, 'warn')
        const { state: after, stop } = advancePlayable(queueRef.current, false, mayPlay)
        if (stop) {
          engine.pause()
          return
        }
        commitQueue(after)
        loadIndex(after, true)
        return
      }
      recovery.skippedInARow = 0
      engine.pause()
      showToast(`Couldn’t play “${title}”: ${state.error}`, 'error')
    }
  }, [engine, loadIndex, mayPlay, commitQueue])

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

  const mutateQueue = useCallback(
    (change: (state: QueueState) => QueueState) => {
      commitQueue(change(queueRef.current))
      refreshLookahead(engine)
    },
    [engine, commitQueue],
  )

  // The song that is playing is kept; only what follows it changed, which
  // the engine picks up the next time it asks for the lookahead.
  const toggleShuffle = useCallback(
    () => mutateQueue(state => setShuffle(state, !state.shuffle)),
    [mutateQueue],
  )

  // Repeat changes what follows too: the last song again from the top, or
  // this one over.
  const cycleRepeatMode = useCallback(
    () => mutateQueue(state => ({ ...state, repeat: cycleRepeat(state.repeat) })),
    [mutateQueue],
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
      commitQueue(next)
      if (wasCurrent && next.items.length > 0) loadIndex(next, engine.state.playing)
      else refreshLookahead(engine)
    },
    [engine, loadIndex, commitQueue],
  )

  const reorderQueue = useCallback(
    (from: number, to: number) => mutateQueue(state => moveItem(state, from, to)),
    [mutateQueue],
  )

  const insertIntoQueue = useCallback(
    (at: number, songIds: readonly number[]) =>
      mutateQueue(state => insertAtIndex(state, songIds, at)),
    [mutateQueue],
  )

  const clearQueue = useCallback(() => {
    engine.pause()
    commitQueue(EMPTY_QUEUE)
    refreshLookahead(engine)
  }, [engine, commitQueue])

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

  // Renamed on the way out: `resolveQueue` returns `{ songs, current }`, and a
  // `.current` read during render is indistinguishable from a ref access to
  // the React Compiler, which then gives up on memoising this component.
  //
  // The queue's songs are kept as the same array while they are the same
  // songs. Every edit to the library — a like, a tag, a play counted — remakes
  // `songsById`, and with it this list; as a new array each time it made a new
  // player value, and every screen and control that reads the player was
  // rendered again for a change to a song it does not show.
  const resolvedNow = useMemo(() => resolveQueue(queue, songsById), [queue, songsById])
  const queueSongs = useSameArray(resolvedNow.songs)
  const currentSong = resolvedNow.current
  const resolved = useMemo(() => ({ queueSongs, currentSong }), [queueSongs, currentSong])

  /*
   * The fade into the next song, and gapless, told to the engine. Both come
   * from the server's settings, and a browser plays whatever is passed on
   * here. Auto-mix picks each fade from the two songs, bounded by the setting.
   * A phone's engine ignores both: it is gapless within its own queue and
   * cannot fade.
   */
  const crossfadeSeconds = serverSettings?.crossfadeSeconds ?? 0
  const gapless = serverSettings?.gapless ?? true
  const nextSong = useMemo(() => {
    const id = peekNext(queue)
    return id === null ? null : (songsById.get(id) ?? null)
  }, [queue, songsById])
  const nextCrossfadeSeconds = useMemo(
    () => (autoMix ? autoMixCrossfade(currentSong, nextSong, crossfadeSeconds) : crossfadeSeconds),
    [autoMix, currentSong, nextSong, crossfadeSeconds],
  )
  useEffect(() => {
    // No fade into a song that is about to be stopped: with one, the next song
    // would already be playing when this one "ends".
    engine.configure({ crossfadeSeconds: sleep.atSongEnd ? 0 : nextCrossfadeSeconds, gapless })
  }, [engine, nextCrossfadeSeconds, gapless, sleep.atSongEnd])

  const currentBpm = resolved.currentSong?.audioFeatures?.bpm ?? null
  useEffect(() => {
    engine.setCountIn(countIn ? countInMs(currentBpm) : 0)
  }, [engine, countIn, currentBpm])

  const value = useMemo<PlayerApi>(
    () => ({
      queue,
      songs: resolved.queueSongs,
      current: resolved.currentSong,
      isPlaying: engineState.playing,
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
      getPlayhead: () => engine.playhead,
      analyser: () => (engine.capabilities.analyser ? engine.analyser() : null),
      toggleShuffle,
      cycleRepeatMode,
      playNext,
      addToQueue,
      insertIntoQueue,
      removeFromQueue,
      reorderQueue,
      clearQueue,
      sleepTimerEndsAt: sleep.endsAt,
      sleepAtSongEnd: sleep.atSongEnd,
      setSleepTimer: sleep.set,
      autoMix,
      canCrossfade: engine.capabilities.crossfade,
      nextCrossfadeSeconds,
      setAutoMix,
      canLoop: engine.capabilities.loop,
      ...practice,
    }),
    [
      stores,
      sleep,
      engine,
      autoMix,
      nextCrossfadeSeconds,
      setAutoMix,
      practice,
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
      insertIntoQueue,
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
   * What the operating system is shown: Control Center and the Dock in the
   * installed app through the media session, the lock screen and Control
   * Center on a phone through the engine, nothing in a tab that has no media
   * session. The artwork is chosen the same way for both (`nowPlayingArtwork`).
   *
   * The playing song's kept cover is read when the covers change, not on
   * every render, and one song's rather than a map of every cover on the
   * device to look one up in.
   */
  // Read again whenever a cover arrives. The covers already on disk are read in
  // at launch and announced once, and a subscription made in an effect could
  // miss that — then every song was shown with the server's address all
  // session. `useSyncExternalStore` checks the version again once subscribed.
  const coversSeen = useSyncExternalStore(subscribeCovers, coversVersion, coversVersion)
  // `coversSeen` is not read, but it is why the cover is looked up again.
  const keptCover = useMemo(
    () => (currentSong ? coverFor(currentSong.id) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentSong, coversSeen],
  )
  const nowPlayingArt = useMemo(
    () =>
      currentSong
        ? nowPlayingArtwork(currentSong, artSources(keptCover, connection, fromCloud))
        : null,
    [currentSong, keptCover, connection, fromCloud],
  )
  useNowPlaying(value, stores.progress, nowPlayingArt, engineState.rate)
  // The phone's card is the engine's: it hears here when the playing song's
  // cover arrives or its words change, and sends only what did.
  const currentTitle = currentSong?.title
  const currentArtist = currentSong?.artist
  const currentAlbum = currentSong?.album
  useEffect(() => {
    if (currentId !== null) refreshNowPlaying(engine, currentId)
  }, [engine, currentId, currentTitle, currentArtist, currentAlbum, nowPlayingArt])

  return (
    <PlayerContext.Provider value={value}>
      <PlayerStoresContext.Provider value={stores}>{children}</PlayerStoresContext.Provider>
    </PlayerContext.Provider>
  )
}

/**
 * The addresses this device has for a library's media: the bucket's, through
 * whatever this platform has that can attach the doorman's header, and the
 * connected server's. Which of the two answers is the address model's rule.
 */
function mediaSources(
  connection: Parameters<typeof mediaUrlFor>[0] | null,
  fromCloud: boolean,
): Omit<MediaSources, 'local'> {
  return {
    bucket: bucketMedia,
    server: connection ? serverRoutes(mediaUrlFor(connection), KEPT_COVER_SIZE) : null,
    fromCloud,
  }
}

/** The engine's level, as the volume control draws it. */
function volumeOf(state: EngineState): VolumeState {
  return { volume: state.volume, muted: state.muted }
}

/** The engine's practice state, as the practice panel and its chips draw it. */
function practiceOf(state: EngineState): PracticeState {
  return {
    loopA: state.loopA,
    loopB: state.loopB,
    countingIn: state.countingIn,
    rate: state.rate,
    preservesPitch: state.preservesPitch,
  }
}

/** Where the Now Playing card may take a cover from: a copy here, or this library's address. */
function artSources(
  kept: string | undefined,
  connection: Parameters<typeof mediaUrlFor>[0] | null,
  fromCloud: boolean,
): ArtSources {
  const sources = mediaSources(connection, fromCloud)
  return { kept, remoteArt: (songId, rev) => artAddress(songId, rev, sources) }
}

/** The phone's engine re-tells the lock screen; the browser's has a media session for that. */
function refreshNowPlaying(engine: unknown, songId: number): void {
  const candidate = engine as { refreshNowPlaying?: (songId: number) => void }
  candidate.refreshNowPlaying?.(songId)
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

/**
 * How long a stall has to last before it is shown. Long enough that taking a
 * track off this device never draws one, short enough that a real wait says so
 * before it is felt as the app being stuck.
 */
const STALL_SHOWS_AFTER_MS = 320

/** Waiting on the network mid-song, which shows differently from paused. */
export function usePlayerStalled(): boolean {
  const { stalled } = useStores()
  return useSyncExternalStore(stalled.subscribe, stalled.get, stalled.get)
}

/**
 * The level and whether it is muted. Only the volume control should draw
 * these: a drag of its slider sets them on every frame.
 */
export function usePlayerVolume(): VolumeState {
  const { volume } = useStores()
  return useSyncExternalStore(volume.subscribe, volume.get, volume.get)
}

/** The loop, the count-in, the speed and the pitch lock, as they stand. */
export function usePracticeState(): PracticeState {
  const { practice } = useStores()
  return useSyncExternalStore(practice.subscribe, practice.get, practice.get)
}

/** For a row drawn outside any player, such as a test: nothing is ever loaded. */
const NO_PLAYBACK = createValueStore<SongPlaybackState>({ songId: null, playing: false })

/**
 * `playing` or `paused` when this song is the loaded one, and null otherwise.
 *
 * What a song row asks instead of `usePlayer()`, which every row would hear
 * every change through. The answer is a primitive per row, so a new song
 * re-renders the row it left and the row it reached, and a pause re-renders one.
 */
export function useSongPlayback(songId: number): 'playing' | 'paused' | null {
  const store = useContext(PlayerStoresContext)?.playback ?? NO_PLAYBACK
  const read = useCallback(() => songPlayback(store.get(), songId), [store, songId])
  return useSyncExternalStore(store.subscribe, read, read)
}

/**
 * Whether a song is loaded, for the chrome that floats over a phone's page and
 * makes room for the mini player. False outside the provider rather than an
 * error, so a screen rendered alone in a test draws.
 */
export function useSongLoaded(): boolean {
  return (useContext(PlayerContext)?.current ?? null) !== null
}

export function usePlayer(): PlayerApi {
  const value = useContext(PlayerContext)
  if (!value) throw new Error('usePlayer must be used inside a PlayerProvider')
  return value
}
