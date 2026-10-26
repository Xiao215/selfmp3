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
  isResting,
  playNext as playNextIds,
  previous as previousInQueue,
  removeAt,
  resolveQueue,
  setShuffle,
  withoutSongs,
  withUpcoming,
  type QueueState,
  type Song,
} from '@selfmp3/shared'
import {
  advancePlayable,
  autoMixCrossfade,
  autoMixOrder,
  busyRetryDelay,
  type EngineState,
  type FrequencyAnalyser,
  type ServerConnection,
  listenedDelta,
  peekPlayable,
  recoverPlayback,
  skipFailed,
  useSameArray,
} from '@selfmp3/client'
import { sourceAfterAdding, type ListSource } from '../features/lists/lists.model'
import { withOnlyPlaying, withRestRestored } from '../features/queue/queue.model'
import {
  artAddress,
  streamAddress,
  streamHeaders,
  type MediaSources,
} from '../api/mediaAddress.model'
import { mediaSourcesFor } from '../api/mediaSources'
import { isLenderCap } from '../ports/bucketRefusal'
import { isStorageBusy, isUnreachable, stoppedOn } from '../ports/streamFailure.model'
import { configureBucketMedia } from '../ports/bucketMedia'
import { prefs } from '../ports/prefs'
import { recentUri } from '../ports/recentCopies'
import { session as cloudSession } from '../replica'
import { coverFor, coversVersion, KEPT_COVER_SIZE, subscribeCovers } from '../offline/covers'
import { useDownloads } from '../offline/DownloadsProvider'
import { createEngine } from '../ports/engine'
import { useCrossfadeSeconds } from './crossfadePref'
import { useVolumeControls } from './useVolumeControls'
import { useSleepTimer } from './useSleepTimer'
import { usePlayReporting } from './usePlayReporting'
import { useConnection } from '../connection/ConnectionProvider'
import { currentToasts, dismissToast, showToast, type ToastWords } from '../ui/toast'
import { nowPlayingArtwork, type ArtSources } from './nowPlayingArt.model'
import { handleRemoteCommands } from './remoteCommands'
import { passOverResting, type ListStart } from './resting.model'
import { useNowPlaying } from './useNowPlaying'
import {
  createProgressStore,
  differsBesidesClock,
  samePlayback,
  sameVolume,
  songPlayback,
  type PlayerProgress,
  type ProgressStore,
  type SongPlaybackState,
  type VolumeState,
} from './progress.model'
import { createValueStore, type ValueStore } from '../state/valueStore.model'
import { useValueStore } from '../state/useValueStore'
import { useSongsById } from '../ui/songsById'
import { roomTrack, useRoomTracks, withRoomSongs } from './roomTracks'
import { pressed } from './roomTransport'
import { checkRoomLink, currentRoom, subscribeRoom } from '../features/room/room.store'
import { thisPlace } from '../ports/place'

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

/** How a list starts playing: `PlayerApi.playFrom`'s options. */
interface PlayOptions {
  /** Sets the shuffle mode first; left out, the mode is kept. */
  readonly shuffle?: boolean
  /**
   * Starts the first song part-way, which is what a handoff needs: a separate
   * `seekTo` straight after would land before the track has loaded and be lost.
   */
  readonly position?: number
  /** False loads the song paused: a resume offer, which never starts audio by itself. */
  readonly autoplay?: boolean
  /**
   * What these songs are (docs/features/lists.md): the name Up next wears and
   * what Save makes of it. Left out, Up next is nameless.
   *
   * A list with a source is played as a list: its resting songs are passed
   * over (`passOverResting`), but for the one whose row was tapped. Songs you
   * picked are played as picked.
   */
  readonly source?: ListSource | null
  /** The list's own Play, not a tapped row: a resting song where it starts is passed over too. */
  readonly whole?: boolean
}

export interface PlayerApi {
  readonly queue: QueueState
  readonly songs: readonly Song[]
  readonly current: Song | null
  readonly isPlaying: boolean
  /** Where what is in Up next came from, or null when nothing says. */
  readonly source: ListSource | null
  /**
   * The last song ran out with nothing after it, and has not been played or
   * moved since: it stays loaded, paused at its end, and Up next says what
   * could come next (docs/features/lists.md).
   */
  readonly ranOut: boolean
  /** Start these songs here. Up next becomes them, named by `options.source`. */
  playFrom: (songIds: readonly number[], startIndex: number, options?: PlayOptions) => void
  playShuffled: (songIds: readonly number[], source?: ListSource | null) => void
  /** Up next's songs stay; what they are called changes: Save has made them a playlist. */
  setSource: (source: ListSource | null) => void
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
  /** One Repeat mode by name: the Mac menu's Repeat › Off, All, One. */
  setRepeatMode: (mode: QueueState['repeat']) => void
  playNext: (songIds: readonly number[]) => void
  addToQueue: (songIds: readonly number[]) => void
  removeFromQueue: (index: number) => void
  reorderQueue: (from: number, to: number) => void
  /** Put songs at one place in the queue: where a drag let go of them. */
  insertIntoQueue: (at: number, songIds: readonly number[]) => void
  /**
   * Everything after the playing song, replaced by these in this order: a
   * room's host keeping Up next the room's list (features/room).
   */
  setUpcoming: (songIds: readonly number[]) => void
  /** Empty the queue and stop: signing out. */
  clearQueue: () => void
  /**
   * Up next's "Clear the rest": every song but the one playing goes, and the
   * music carries on. Hands back the queue as it was, for the Undo.
   */
  clearRest: () => QueueState
  /** The Undo for `clearRest`: the songs it took, back in their places, while the same song plays. */
  restoreRest: (before: QueueState) => void
  /**
   * Songs that have just left the library: out of the queue, and if one of them
   * is playing, the music stops — the next song waits, paused, or with none
   * after it nothing is left playing.
   */
  forgetSongs: (songIds: readonly number[]) => void
  /** When the sleep timer stops playback, or null when none is set. */
  readonly sleepTimerEndsAt: number | null
  /** The sleep timer waits for the song playing to end, rather than a clock. */
  readonly sleepAtSongEnd: boolean
  /** The level itself is `usePlayerVolume()`'s: it moves too often to ride here. */
  setVolume: (volume: number) => void
  /** Up or down by one step from where the level is now. */
  stepVolume: (delta: number) => void
  toggleMute: () => void
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
}

/**
 * What `PlayerApi` can be asked to do, without anything it says.
 *
 * Every one of these is made once and kept, so this is a value that never
 * changes: a screen that only starts songs — a list's Play, a row's tap —
 * reads it through `usePlayerCommands()` and is not rendered again for a
 * play, a pause or a song added to Up next.
 */
type PlayerCommands = Pick<
  PlayerApi,
  | 'playFrom'
  | 'playShuffled'
  | 'setSource'
  | 'jumpTo'
  | 'toggle'
  | 'next'
  | 'previous'
  | 'seekTo'
  | 'seekBy'
  | 'getPosition'
  | 'subscribeProgress'
  | 'getPlayhead'
  | 'analyser'
  | 'toggleShuffle'
  | 'cycleRepeatMode'
  | 'setRepeatMode'
  | 'playNext'
  | 'addToQueue'
  | 'removeFromQueue'
  | 'reorderQueue'
  | 'insertIntoQueue'
  | 'setUpcoming'
  | 'clearQueue'
  | 'clearRest'
  | 'restoreRest'
  | 'forgetSongs'
  | 'setVolume'
  | 'stepVolume'
  | 'toggleMute'
  | 'setSleepTimer'
  | 'setAutoMix'
>

/** Auto-mix, kept on this device. */
const AUTO_MIX_KEY = 'automix'

const PlayerContext = createContext<PlayerApi | null>(null)
const PlayerCommandsContext = createContext<PlayerCommands | null>(null)

/**
 * The facts that move too often, or matter to too few, to ride in `PlayerApi`.
 *
 * Made once per provider and never replaced, so this context itself never
 * changes; each hook below subscribes to the one store it reads. `stalled`
 * lives here rather than in `PlayerApi` because every waiting/playing pair
 * from the network would otherwise re-render every screen and row that asks
 * for the player; and the volume, because a drag of the slider sets it on
 * every frame.
 */
interface PlayerStores {
  readonly progress: ProgressStore
  readonly playback: ValueStore<SongPlaybackState>
  readonly stalled: ValueStore<boolean>
  readonly volume: ValueStore<VolumeState>
}

const PlayerStoresContext = createContext<PlayerStores | null>(null)

/** A room's song counts as a play of your own copy of it, when you have one, and of nothing else. */
function countPlayAs(songId: number): number | null {
  const track = roomTrack(songId)
  return track ? track.yours : songId
}

export function PlayerProvider({ children }: { children: ReactNode }): ReactNode {
  const { connection, fromCloud } = useConnection()
  const {
    queue: downloadQueue,
    checkPlay: checkLibraryPlay,
    mayPlay: mayLibraryPlay,
    keepPlayed: keepLibraryPlayed,
    keepAhead,
  } = useDownloads()

  /*
   * A room's song (roomTracks.ts) plays from your own copy when you have one
   * that can play here, and otherwise from where the room lends it: the
   * doorman, or the host's server for a link. Either way nothing about it is
   * this device's to download first, so it never waits on the questions a
   * library song asks (mobile data, a song not kept).
   */
  const mayPlay = useCallback(
    (songId: number): boolean => {
      const track = roomTrack(songId)
      if (!track) return mayLibraryPlay(songId)
      return track.stream !== null || (track.yours !== null && mayLibraryPlay(track.yours))
    },
    [mayLibraryPlay],
  )
  const checkPlay = useCallback(
    (songId: number, retry: () => void): boolean => {
      const track = roomTrack(songId)
      if (!track) return checkLibraryPlay(songId, retry)
      if (track.stream !== null) return true
      // Nowhere to play it from here — a link only the host's device can
      // reach: the room moves on without this device.
      return track.yours !== null && checkLibraryPlay(track.yours, retry)
    },
    [checkLibraryPlay],
  )
  /** A room's song counts as a play of your own copy, when you have one, and of nothing else. */
  const keepPlayed = useCallback(
    (songId: number) => {
      if (!roomTrack(songId)) keepLibraryPlayed(songId)
    },
    [keepLibraryPlayed],
  )
  const crossfadeSeconds = useCrossfadeSeconds()

  // Built once and kept: an engine outlives every render, and rebuilding it
  // would mean dropping the audio that is playing. Its wiring is handed over
  // with `connect` rather than assigned, which is the same point made in the
  // port.
  const [engine] = useState(createEngine)
  const [queue, setQueue] = useState<QueueState>(EMPTY_QUEUE)
  const [source, setSource] = useState<ListSource | null>(null)
  /*
   * The queue the last song ran out in (`ranOut`). Compared by identity, so
   * any change to the queue — a new list, a song added — ends it without
   * anyone having to clear it; playing, seeking and Previous clear it here.
   */
  const [ranOutIn, setRanOutIn] = useState<QueueState | null>(null)
  const [engineState, setEngineState] = useState<EngineState>(() => engine.state)
  // Playing again, however it was asked for — the button, the lock screen, a
  // headset — is no longer the end of anything. Adjusted during render.
  if (engineState.playing && ranOutIn !== null) setRanOutIn(null)
  const [autoMix, setAutoMixState] = useState(() => prefs.get(AUTO_MIX_KEY) === '1')
  const [stores] = useState<PlayerStores>(() => ({
    progress: createProgressStore(),
    playback: createValueStore<SongPlaybackState>({ songId: null, playing: false }, samePlayback),
    stalled: createValueStore(false),
    volume: createValueStore(volumeOf(engine.state), sameVolume),
  }))

  const librarySongs = useSongsById()
  const songsById = withRoomSongs(librarySongs, useRoomTracks())

  // Refs so the engine's callbacks always see current values without being
  // torn down and rewired on every render.
  const queueRef = useRef(queue)
  const songsRef = useRef(songsById)
  const connectionRef = useRef(connection)
  const fromCloudRef = useRef(fromCloud)
  const lastPositionRef = useRef(0)
  const autoMixRef = useRef(autoMix)
  // Told every engine state; set once the commands it needs exist, below.
  const playbackErrorRef = useRef<(state: EngineState) => void>(() => undefined)
  /*
   * Whether sound was asked for and not paused since: a play, a skip while
   * playing, Play pressed. A song that fails is only retried or skipped while
   * this holds, so a song put back paused when the app opens never walks the
   * queue, and a Pause pressed while songs fail one after another sticks.
   * The engine's own `playing` cannot say it: a failing song is never playing.
   */
  const wantsSoundRef = useRef(false)

  /*
   * The one way the queue changes: the ref first, then the state.
   *
   * The ref is what every command and every engine callback reads, and it has
   * to be right the moment a command returns, not after the render that
   * follows: filled in by an effect, two commands in one tick — a headset's
   * double-tap sending Next twice, a drop into Up next calling `next()` and
   * then `addToQueue` — would both read the queue from before the first, and
   * the phone's lookahead, asked for the next song straight after a skip,
   * would be told the song just left. State still renders what is shown; the
   * ref is the source of truth for what happens next.
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
   * What a phone or the desktop app needs to stream a bucket song: each song's
   * key there, and the doorman session to ask with (ports/bucketMedia.ts;
   * nothing, in a tab, whose service worker looks both up for itself). The library is read through
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
     * straight through, the phone would flash a spinner on every press of
     * play — one tap, four changes of glyph. A stall that clears
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
   * The volume and the sleep timer: a line or two each over the engine. The
   * seams below — wiring the engine, the commands — stay here, because each
   * holds a dozen refs the others read; pulled apart they would take a dozen
   * arguments, which is a worse seam than a long function.
   */
  const volume = useVolumeControls(engine)
  const sleep = useSleepTimer(engine)

  /*
   * A song that counts as played is kept, where songs stream from the bucket,
   * and so is the one after it, ahead of time: it then plays from the disk,
   * joined gaplessly, and is never asked of the bucket a second time. A
   * phone's stream is already that one download (`recentCopies.ts`,
   * `streamOnce`), which keeping it joins. Lent to the player again once it
   * is here.
   */
  const keepPlayedAndNext = useCallback(
    (songId: number) => {
      keepPlayed(songId)
      const next = peekPlayable(queueRef.current, mayPlay)
      if (next === null || next === songId || roomTrack(next)) return
      void keepAhead(next).then(kept => {
        if (kept) engine.refreshLookahead?.()
      })
    },
    [engine, keepAhead, keepPlayed, mayPlay],
  )
  // Counting a play and sending what this device kept. The tracking ref is
  // handed out, because the engine's callbacks below write to it as the song
  // runs.
  const { tracking: trackingRef, flushPlay } = usePlayReporting({
    songs: songsRef,
    countAs: countPlayAs,
    keepPlayed: keepPlayedAndNext,
    connection,
  })

  // --- engine wiring -------------------------------------------------------

  // The two parts of the sleep timer the wiring reads, both made once: the
  // timer object itself is new whenever it is set, and the engine would be
  // wired again for it.
  const { atSongEndRef: sleepAtSongEndRef, songEnded: sleepSongEnded } = sleep

  /**
   * A song waiting out a busy storage before it is asked for again
   * (`retry-later`), drawn as the play button's spinner while it waits.
   */
  const busyWaitRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const callOffBusyWait = useCallback(() => {
    if (busyWaitRef.current === null) return
    clearTimeout(busyWaitRef.current)
    busyWaitRef.current = null
    stores.stalled.set(false)
  }, [stores])
  useEffect(() => () => callOffBusyWait(), [callOffBusyWait])
  /**
   * Playing, or waiting out a busy storage to: the song is on its way, spinner
   * and all, so Pause calls the wait off and Next lands on a song that plays.
   */
  const soundOn = useCallback(() => engine.state.playing || busyWaitRef.current !== null, [engine])

  const loadIndex = useCallback(
    (state: QueueState, autoplay: boolean, startAt?: number) => {
      const songId = state.items[state.index]
      if (songId === undefined) return
      callOffBusyWait()
      wantsSoundRef.current = autoplay
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
    [engine, stores, trackingRef, callOffBusyWait],
  )

  /** Paused by the player itself, and nothing to start again until someone presses Play. */
  const halt = useCallback(() => {
    wantsSoundRef.current = false
    callOffBusyWait()
    engine.pause()
  }, [engine, callOffBusyWait])

  // Everywhere a song's bytes might come from, on this device, right now.
  const sourcesFor = useCallback(
    (songId: number): MediaSources => {
      const song = songsRef.current.get(songId)
      return {
        // A file here wins whenever there is one — a download first, then a copy
        // kept because it was played. It is the only thing that plays with no
        // signal, and it is the same song either way.
        // With the song's own rev and audio, so a file kept under a reused id,
        // or of audio the song has since replaced, is not played as the song
        // (`entryIsCurrent`, and the played copy's name).
        local: downloadQueue.localUri(songId, song?.rev) ?? recentUri(song),
        ...mediaSourcesFor(connectionRef.current, fromCloudRef.current, KEPT_COVER_SIZE),
      }
    },
    [downloadQueue],
  )

  /** The library song a room's track plays as: your own copy, when it can play here. */
  const ownCopy = useCallback(
    (track: { readonly yours: number | null }): number | null =>
      track.yours !== null && mayLibraryPlay(track.yours) ? track.yours : null,
    [mayLibraryPlay],
  )

  useEffect(() => {
    return engine.connect({
      // Past songs that cannot play here, so a lookahead never preloads one.
      nextTrackId: () => peekPlayable(queueRef.current, mayPlay),

      streamUrl: songId => {
        const track = roomTrack(songId)
        const from = track ? ownCopy(track) : songId
        if (from === null) return track?.stream?.url ?? ''
        return streamAddress(from, songsRef.current.get(from)?.rev, sourcesFor(from))
      },
      // Decided by the same rule over the same sources, so an address and what
      // has to be sent with it can never come from two different places.
      streamHeaders: songId => {
        const track = roomTrack(songId)
        const from = track ? ownCopy(track) : songId
        if (from === null) return track?.stream?.headers ?? null
        return streamHeaders(sourcesFor(from))
      },

      trackMetadata: songId => {
        // A room's song is asked for the moment the room hands it over, which
        // can be before this provider has drawn with it.
        const track = roomTrack(songId)
        const song = songsRef.current.get(songId) ?? track?.song
        if (!song) return null
        if (track) {
          return {
            title: song.title,
            artist: song.artist,
            album: song.album,
            ...(track.cover ? { artwork: track.cover } : {}),
            ...(song.duration > 0 ? { duration: song.duration } : {}),
            contentType: song.mime,
          }
        }
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
        // A song that ran out is let off the last tick the player may not have
        // counted — but only if it was heard (shared `countsAsPlay`): seeking
        // to the end runs a song out too.
        flushPlay(true)

        // "End of this song": used up by the first song to end after it was
        // chosen, whichever that is — skipping ahead meanwhile moves the stop
        // with you rather than cancelling it.
        const sleeping = sleepAtSongEndRef.current
        if (sleeping) sleepSongEnded()

        // Past songs that cannot play here: one not on this device, offline,
        // would otherwise load and sit paused with no word.
        const ended = queueRef.current
        const { state, stop } = advancePlayable(ended, true, mayPlay)
        if (stop) {
          halt()
          setRanOutIn(ended)
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
    mayPlay,
    ownCopy,
    sourcesFor,
    stores,
    sleepAtSongEndRef,
    sleepSongEnded,
    trackingRef,
    commitQueue,
    halt,
  ])

  // --- commands ------------------------------------------------------------

  /*
   * A song that stops with an error: tried again, then skipped, then stopped,
   * and each said on screen (recoverPlayback), so a dropped connection does
   * not end the music without a word.
   */
  const recoveryRef = useRef({
    lastError: null as string | null,
    retriedSongId: null as number | null,
    retriedFrom: 0,
    skippedInARow: 0,
    /** Times the song has been asked for again from a busy storage, with none of it playing since. */
    busyTries: 0,
    /** The skip message on screen, replaced rather than stacked. */
    toastId: null as number | null,
  })
  /**
   * Someone chose what to play: whatever failed before is behind them, and
   * this song is tried again, and its run of skips counted, afresh.
   */
  const freshRun = useCallback(() => {
    recoveryRef.current.retriedSongId = null
    recoveryRef.current.skippedInARow = 0
    recoveryRef.current.busyTries = 0
  }, [])

  /** Resting now (shared rest.ts): read when a list starts, so a song wakes by itself. */
  const resting = useCallback((songId: number): boolean => {
    const song = songsRef.current.get(songId)
    return song !== undefined && isResting(song)
  }, [])

  /** What of a list plays (`PlayOptions.source`): resting songs are passed over. */
  const listed = useCallback(
    (list: ListStart, options: PlayOptions): ListStart => {
      const { source } = options
      if (!source || (source.kind === 'songs' && source.origin === 'selection')) return list
      return passOverResting(list, resting, options.whole !== true)
    },
    [resting],
  )

  const play = useCallback(
    (asked: readonly number[], at: number, options: PlayOptions = {}) => {
      const { shuffle, position, autoplay = true } = options
      const { songIds, startIndex } = listed({ songIds: asked, startIndex: at }, options)
      const start = (): void => {
        // "Play" on a list means in order; a tapped row keeps whatever mode is
        // on.
        const from = shuffle === undefined ? queueRef.current : { ...queueRef.current, shuffle }
        const next = mixed(playFrom(from, songIds, startIndex))
        commitQueue(next)
        setSource(options.source ?? null)
        freshRun()
        loadIndex(next, autoplay, position)
      }
      // A song that cannot play here says why, rather than loading and sitting
      // paused; one that needs a yes (mobile data) starts once it has one.
      const songId = songIds[startIndex]
      if (songId !== undefined && !checkPlay(songId, start)) return
      start()
    },
    [loadIndex, checkPlay, mixed, commitQueue, freshRun, listed],
  )

  /**
   * "Shuffle" as a verb: turn shuffle on, pick a random starting track, play.
   *
   * `playFrom` keeps the chosen track first and shuffles the rest behind it,
   * so choosing the start at random is what makes this genuinely random rather
   * than "always begins with track one".
   */
  const playShuffled = useCallback(
    (all: readonly number[], listSource: ListSource | null = null) => {
      // Shuffle passes over resting songs, whatever the list.
      const { songIds } = passOverResting({ songIds: all, startIndex: 0 }, resting, false)
      if (songIds.length === 0) return
      const begin = (start: number): void => {
        const next = playFrom({ ...queueRef.current, shuffle: true }, songIds, start)
        commitQueue(next)
        setSource(listSource)
        freshRun()
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
    [loadIndex, checkPlay, mayPlay, commitQueue, freshRun, resting],
  )

  const jumpTo = useCallback(
    (index: number) => {
      const go = (): void => {
        const next = { ...queueRef.current, index }
        commitQueue(next)
        freshRun()
        loadIndex(next, true)
      }
      const songId = queueRef.current.items[index]
      if (songId !== undefined && !checkPlay(songId, go)) return
      go()
    },
    [loadIndex, checkPlay, commitQueue, freshRun],
  )

  const toggle = useCallback(() => {
    if (soundOn()) {
      halt()
      return
    }
    // An emptied queue has nothing to play, though the engine may still hold
    // the song it last had: one cleared or removed, which must not come back.
    const queueNow = queueRef.current
    const songId = queueNow.items[queueNow.index]
    if (songId === undefined) return
    // A song that failed is asked for again, from where it was: played as it
    // stands, the player sat on its error and nothing was fetched, even with
    // the library back.
    if (engine.state.error !== null || engine.currentSongId !== songId) {
      freshRun()
      const at = lastPositionRef.current
      loadIndex(queueNow, true, at > 0 ? at : undefined)
      return
    }
    wantsSoundRef.current = true
    void engine.play()
  }, [engine, halt, freshRun, loadIndex, soundOn])

  /*
   * Next and Previous change the song, never whether it is playing: paused,
   * they land on the new song paused, the way a restart does — so Previous
   * does not leave a paused player paused or set it playing depending only on
   * whether it was past three seconds.
   */
  const next = useCallback(() => {
    // Pressing Next is not the song running out: `auto` false, so repeat-one
    // moves on rather than playing the same song again.
    const { state, stop } = advancePlayable(queueRef.current, false, mayPlay)
    if (stop) return
    const playing = soundOn()
    commitQueue(state)
    freshRun()
    loadIndex(state, playing)
  }, [loadIndex, mayPlay, commitQueue, freshRun, soundOn])

  const previous = useCallback(() => {
    setRanOutIn(null)
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
    const playing = soundOn()
    commitQueue(state)
    freshRun()
    loadIndex(state, playing)
  }, [engine, loadIndex, commitQueue, freshRun, soundOn])

  // The lock screen's and the headphones' Next and Previous, as these buttons.
  useEffect(
    () => handleRemoteCommands(command => (command === 'next' ? next() : previous())),
    [next, previous],
  )

  /*
   * A room's song waiting out a dropped connection, picked up where it
   * stopped once the room hears this device again. A follower is then put
   * back in step by the room's provider.
   */
  const roomWaitRef = useRef<{ songId: number; at: number } | null>(null)
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
      // Sound again, whichever song it is: "Couldn’t play …" is no longer
      // true, and an error is kept up until dismissed, so it sat over the
      // song now playing — the one it named, once Play found it, or the next.
      // Nor is "Storage is busy, trying again", which stays up while it waits.
      if (state.playing && state.error === null && recovery.toastId !== null) {
        const up = currentToasts().find(toast => toast.id === recovery.toastId)
        const over = up?.tone === 'error' || recovery.busyTries > 0
        if (up && over) dismissToast(up.id)
        if (!up || over) recovery.toastId = null
      }
      // Any of it arriving: the storage is answering again.
      if (state.playing && state.error === null) recovery.busyTries = 0

      // Each load clears the error first, so a failure is the error arriving.
      // A second report of the same failure — in other words, or late — is
      // not another song failing: taken as one, it restarted the run of
      // skips that is meant to stop at three.
      const failed = state.error !== null && recovery.lastError === null
      recovery.lastError = state.error
      if (!failed || songId === undefined) return
      // The engine's words ("“Evening” can’t be played on this phone yet",
      // a media error's code) are for whoever is debugging; the toast says
      // which song, and what happened to it.
      console.warn(`Playback failed for song ${songId}:`, state.error)

      // A friend's song whose bucket is out of reads for the day: their news,
      // in the doorman's words. Trying it again, or their next song, is only
      // another refusal.
      if (roomTrack(songId) && isLenderCap(state.error)) {
        if (recovery.toastId !== null) dismissToast(recovery.toastId)
        recovery.toastId = showToast(state.error, 'error')
        halt()
        return
      }

      // A room's song that stops may be the connection rather than the song.
      // The room is asked whether it can still hear this device: while it
      // cannot, the song waits where it stopped and goes on once the room is
      // back (below), rather than being skipped down the room's list.
      const why = state.error
      if (roomTrack(songId) && currentRoom().pass) {
        const at = lastPositionRef.current
        void checkRoomLink().then(alive => {
          if (queueRef.current.items[queueRef.current.index] !== songId) return
          if (alive) recover(songId, why)
          else roomWaitRef.current = { songId, at }
        })
        return
      }
      recover(songId, why)
    }

    const recover = (songId: number, why: string | null = null): void => {
      const unreachable = isUnreachable(why)
      const busy = isStorageBusy(why)
      const recovery = recoveryRef.current
      const title =
        songsRef.current.get(songId)?.title ?? roomTrack(songId)?.song.title ?? 'this song'
      // One message about skipping at a time. A run of songs that would not
      // play folds into it ("Skipped, they wouldn't play · 3 songs") rather
      // than stacking a toast apiece up the screen, which reads as the app
      // falling apart; anything else said replaces it.
      const say = (message: string | ToastWords, tone: 'warn' | 'error', fold?: string): void => {
        const folding =
          fold !== undefined &&
          currentToasts().some(toast => toast.id === recovery.toastId && toast.group === fold)
        if (recovery.toastId !== null && !folding) dismissToast(recovery.toastId)
        const song = songsRef.current.get(songId)
        recovery.toastId = showToast(message, tone, {
          group: fold,
          songs: fold && song ? [song] : [],
        })
      }
      // Nobody is waiting on it: a song put back paused, or paused since.
      // It stays where it is until Play is pressed, which asks for it again.
      if (!wantsSoundRef.current) return
      // Failed because it cannot play here now — the bucket refusing reads
      // for the day, found out by this very failure (ports/engine.ts). Not a
      // broken song: no retry, and not one of the three skips that stop the
      // music, or a refusal would stop it before the songs on this device.
      if (!mayPlay(songId)) {
        recovery.retriedSongId = null
        const { state: after, stop } = skipFailed(queueRef.current, mayPlay)
        // Passed over quietly: its row is faded, which says the same thing
        // without a word. Only running out of songs that can play is said.
        if (stop) {
          say(`Nothing after this is on this ${thisPlace()}`, 'warn')
          halt()
          return
        }
        commitQueue(after)
        loadIndex(after, true)
        return
      }
      const recovering = recoverPlayback({
        songId,
        wantsSound: wantsSoundRef.current,
        retriedSongId: recovery.retriedSongId,
        skippedInARow: recovery.skippedInARow,
        hasNext: !skipFailed(queueRef.current, mayPlay).stop,
        unreachable,
        busy,
        busyTries: recovery.busyTries,
      })
      if (recovering === 'wait') return
      if (recovering === 'retry-later') {
        // The same song, from where it stopped, once the storage has had a
        // moment: the next would be refused the same way. Said once, and kept
        // up until it plays, the run is called off, or the player gives up.
        if (recovery.busyTries === 0) {
          if (recovery.toastId !== null) dismissToast(recovery.toastId)
          recovery.toastId = showToast(
            { over: 'Storage is busy, trying again', say: title },
            'warn',
            { autoDismissMs: 0 },
          )
        }
        const at = lastPositionRef.current
        const delay = busyRetryDelay(recovery.busyTries)
        recovery.busyTries += 1
        callOffBusyWait()
        stores.stalled.set(true)
        busyWaitRef.current = setTimeout(() => {
          busyWaitRef.current = null
          // Paused, or another song chosen, meanwhile: theirs to say.
          const still =
            wantsSoundRef.current &&
            queueRef.current.items[queueRef.current.index] === songId &&
            engine.currentSongId === null
          if (!still) {
            stores.stalled.set(false)
            return
          }
          void engine.load(songId, at > 0 ? { autoplay: true, startAt: at } : { autoplay: true })
        }, delay)
        return
      }
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
        say({ over: 'Skipped, wouldn’t play', say: title }, 'warn', 'playback-skipped')
        const { state: after, stop } = skipFailed(queueRef.current, mayPlay)
        if (stop) {
          halt()
          return
        }
        commitQueue(after)
        loadIndex(after, true)
        return
      }
      // Stopped, and stays stopped: the run is not counted again from nothing
      // here, or one more report of a failure set it running again. Choosing
      // something to play starts a fresh run (`freshRun`).
      halt()
      say(stoppedOn(title, why), 'error')
    }
  }, [engine, loadIndex, mayPlay, commitQueue, halt, callOffBusyWait, stores])

  useEffect(
    () =>
      subscribeRoom(() => {
        const waiting = roomWaitRef.current
        const room = currentRoom()
        if (!waiting) return
        if (!room.pass) roomWaitRef.current = null
        if (room.link !== 'live') return
        roomWaitRef.current = null
        if (queueRef.current.items[queueRef.current.index] !== waiting.songId) return
        // Paused while it waited: it waits on for Play.
        if (!wantsSoundRef.current) return
        void engine.load(
          waiting.songId,
          waiting.at > 0 ? { autoplay: true, startAt: waiting.at } : { autoplay: true },
        )
      }),
    [engine],
  )

  const seekTo = useCallback(
    (seconds: number) => {
      setRanOutIn(null)
      engine.seek(seconds)
    },
    [engine],
  )

  const seekBy = useCallback(
    (delta: number) => {
      // The engine clamps the far end itself — an `<audio>` will not seek past
      // its duration — and this keeps the near one off negative numbers, which
      // some engines answer by refusing to seek at all.
      setRanOutIn(null)
      engine.seek(Math.max(0, lastPositionRef.current + delta))
    },
    [engine],
  )

  const mutateQueue = useCallback(
    (change: (state: QueueState) => QueueState) => {
      commitQueue(change(queueRef.current))
      engine.refreshLookahead?.()
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
  const setRepeatMode = useCallback(
    (mode: QueueState['repeat']) => mutateQueue(state => ({ ...state, repeat: mode })),
    [mutateQueue],
  )

  // Songs added to one song or to the whole library make it a list of your own
  // (`sourceAfterAdding`), which Up next can Save.
  const playNext = useCallback(
    (songIds: readonly number[]) => {
      mutateQueue(state => playNextIds(state, songIds))
      setSource(sourceAfterAdding)
    },
    [mutateQueue],
  )

  const addToQueue = useCallback(
    (songIds: readonly number[]) => {
      mutateQueue(state => mixed(enqueueIds(state, songIds)))
      setSource(sourceAfterAdding)
    },
    [mutateQueue, mixed],
  )

  const removeFromQueue = useCallback(
    (index: number) => {
      const wasCurrent = index === queueRef.current.index
      const next = removeAt(queueRef.current, index)
      commitQueue(next)
      if (wasCurrent && next.items.length > 0) loadIndex(next, soundOn())
      else engine.refreshLookahead?.()
    },
    [engine, loadIndex, commitQueue, soundOn],
  )

  const reorderQueue = useCallback(
    (from: number, to: number) => mutateQueue(state => moveItem(state, from, to)),
    [mutateQueue],
  )

  const insertIntoQueue = useCallback(
    (at: number, songIds: readonly number[]) => {
      mutateQueue(state => insertAtIndex(state, songIds, at))
      setSource(sourceAfterAdding)
    },
    [mutateQueue],
  )

  const setUpcoming = useCallback(
    (songIds: readonly number[]) => {
      const before = queueRef.current
      const after = withUpcoming(before, songIds)
      const same =
        after.index === before.index &&
        after.items.length === before.items.length &&
        after.items.every((id, index) => before.items[index] === id)
      if (!same || before.shuffle) mutateQueue(() => after)
    },
    [mutateQueue],
  )

  const clearQueue = useCallback(() => {
    halt()
    commitQueue(EMPTY_QUEUE)
    setSource(null)
    engine.refreshLookahead?.()
  }, [engine, commitQueue, halt])

  const clearRest = useCallback(() => {
    const before = queueRef.current
    mutateQueue(withOnlyPlaying)
    return before
  }, [mutateQueue])

  const restoreRest = useCallback(
    (before: QueueState) => {
      const back = withRestRestored(queueRef.current, before)
      if (back) mutateQueue(() => back)
    },
    [mutateQueue],
  )

  const forgetSongs = useCallback(
    (songIds: readonly number[]) => {
      const before = queueRef.current
      const next = withoutSongs(before, songIds)
      if (next === before) return
      const playing = before.items[before.index]
      commitQueue(next)
      // Only what follows changed: the engine hears it at the next lookahead.
      if (playing === undefined || !songIds.includes(playing)) {
        engine.refreshLookahead?.()
        return
      }
      // The song playing has gone. Whatever takes its place waits to be asked for.
      halt()
      if (next.index >= 0) loadIndex(next, false)
      else engine.refreshLookahead?.()
    },
    [engine, loadIndex, commitQueue, halt],
  )

  /*
   * Songs gone from the library by another way than this device's own
   * delete — another device's, an import that replaced them — leave the
   * queue the same way (`forgetSongs`), and the one playing says so. Compared with the library before, so
   * a library still loading, which has no songs yet, takes nothing away; a
   * room's songs are the room's, and come and go with it.
   */
  const knownSongsRef = useRef(librarySongs)
  useEffect(() => {
    const before = knownSongsRef.current
    knownSongsRef.current = librarySongs
    if (before === librarySongs || before.size === 0) return
    const { items, index } = queueRef.current
    const gone = items.filter(id => before.has(id) && !librarySongs.has(id) && !roomTrack(id))
    if (gone.length === 0) return
    // The music stopping, or moving on, by itself: said, or it reads as a fault.
    const playing = items[index]
    const title =
      playing !== undefined && gone.includes(playing) ? before.get(playing)?.title : null
    forgetSongs(gone)
    if (title) showToast(`“${title}” is no longer in your library`)
  }, [librarySongs, forgetSongs])

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
   * The fade into the next song, told to the engine: this device's own
   * setting (`crossfadePref.ts`). Auto-mix picks each fade from the two
   * songs, bounded by the setting.
   * A phone's engine ignores it: it is gapless within its own queue and
   * cannot fade.
   */
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
    engine.configure({ crossfadeSeconds: sleep.atSongEnd ? 0 : nextCrossfadeSeconds })
  }, [engine, nextCrossfadeSeconds, sleep.atSongEnd])

  const getPlayhead = useCallback(() => engine.playhead, [engine])
  const analyser = useCallback(
    () => (engine.capabilities.analyser ? engine.analyser() : null),
    [engine],
  )
  const { setVolume, stepVolume, toggleMute } = volume
  const setSleepTimer = sleep.set

  const commands = useMemo<PlayerCommands>(
    () => ({
      playFrom: play,
      playShuffled,
      setSource,
      jumpTo,
      toggle,
      next,
      previous,
      seekTo,
      seekBy,
      getPosition: stores.progress.getPosition,
      subscribeProgress: stores.progress.subscribe,
      getPlayhead,
      analyser,
      toggleShuffle,
      cycleRepeatMode,
      setRepeatMode,
      playNext,
      addToQueue,
      insertIntoQueue,
      setUpcoming,
      removeFromQueue,
      reorderQueue,
      clearQueue,
      clearRest,
      restoreRest,
      forgetSongs,
      setVolume,
      stepVolume,
      toggleMute,
      setSleepTimer,
      setAutoMix,
    }),
    [
      play,
      playShuffled,
      jumpTo,
      toggle,
      next,
      previous,
      seekTo,
      seekBy,
      stores,
      getPlayhead,
      analyser,
      toggleShuffle,
      cycleRepeatMode,
      setRepeatMode,
      playNext,
      addToQueue,
      insertIntoQueue,
      setUpcoming,
      removeFromQueue,
      reorderQueue,
      clearQueue,
      clearRest,
      restoreRest,
      forgetSongs,
      setVolume,
      stepVolume,
      toggleMute,
      setSleepTimer,
      setAutoMix,
    ],
  )

  const value = useMemo<PlayerApi>(
    () => ({
      ...commands,
      // Pressed, in a room this device follows: the room's to answer (roomTransport.ts).
      toggle: () => pressed('toggle', commands.toggle),
      next: () => pressed('next', commands.next),
      previous: () => pressed('previous', commands.previous),
      queue,
      songs: resolved.queueSongs,
      current: resolved.currentSong,
      isPlaying: engineState.playing,
      source,
      ranOut: ranOutIn === queue && !engineState.playing,
      sleepTimerEndsAt: sleep.endsAt,
      sleepAtSongEnd: sleep.atSongEnd,
      autoMix,
      canCrossfade: engine.capabilities.crossfade,
      nextCrossfadeSeconds,
    }),
    [
      commands,
      queue,
      resolved,
      engineState.playing,
      source,
      ranOutIn,
      sleep.endsAt,
      sleep.atSongEnd,
      autoMix,
      engine,
      nextCrossfadeSeconds,
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
  useNowPlaying(value, stores.progress, nowPlayingArt)
  // The phone's card is the engine's: it hears here when the playing song's
  // cover arrives or its words change, and sends only what did.
  const currentTitle = currentSong?.title
  const currentArtist = currentSong?.artist
  const currentAlbum = currentSong?.album
  useEffect(() => {
    if (currentId !== null) engine.refreshNowPlaying?.(currentId)
  }, [engine, currentId, currentTitle, currentArtist, currentAlbum, nowPlayingArt])

  return (
    <PlayerCommandsContext.Provider value={commands}>
      <PlayerContext.Provider value={value}>
        <PlayerStoresContext.Provider value={stores}>{children}</PlayerStoresContext.Provider>
      </PlayerContext.Provider>
    </PlayerCommandsContext.Provider>
  )
}

/** The engine's level, as the volume control draws it. */
function volumeOf(state: EngineState): VolumeState {
  return { volume: state.volume, muted: state.muted }
}

/** Where the Now Playing card may take a cover from: a copy here, or this library's address. */
function artSources(
  kept: string | undefined,
  connection: ServerConnection | null,
  fromCloud: boolean,
): ArtSources {
  const sources = mediaSourcesFor(connection, fromCloud, KEPT_COVER_SIZE)
  return { kept, remoteArt: (songId, rev) => artAddress(songId, rev, sources) }
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
  return useValueStore(stalled)
}

/**
 * The level and whether it is muted. Only the volume control should draw
 * these: a drag of its slider sets them on every frame.
 */
export function usePlayerVolume(): VolumeState {
  const { volume } = useStores()
  return useValueStore(volume)
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
  // The playback store rather than the player: the player is a new value for
  // every play, pause and queue edit, and every scrolling page asks this for
  // the room at its foot.
  const store = useContext(PlayerStoresContext)?.playback ?? NO_PLAYBACK
  const read = useCallback(() => store.get().songId !== null, [store])
  return useSyncExternalStore(store.subscribe, read, read)
}

/**
 * Whether something is playing, and nothing else of the player: for a control
 * that only draws play or pause, or stops the music while it makes its own.
 */
export function usePlayerPlaying(): boolean {
  const store = useContext(PlayerStoresContext)?.playback ?? NO_PLAYBACK
  const read = useCallback(() => store.get().playing, [store])
  return useSyncExternalStore(store.subscribe, read, read)
}

/**
 * The song this device has loaded, by id, or null. For something that draws
 * where the playing song is in a list and nothing else of the player: a new
 * song renders it, a pause does not.
 */
export function usePlayingSongId(): number | null {
  const store = useContext(PlayerStoresContext)?.playback ?? NO_PLAYBACK
  const read = useCallback(() => store.get().songId, [store])
  return useSyncExternalStore(store.subscribe, read, read)
}

/**
 * What the player can be asked to do, and nothing it says: a value made once.
 * For anything that only starts, skips or queues songs — it is not rendered
 * again when the player's state moves, as a `usePlayer()` caller is.
 */
export function usePlayerCommands(): PlayerCommands {
  const value = useContext(PlayerCommandsContext)
  if (!value) throw new Error('usePlayerCommands must be used inside a PlayerProvider')
  return value
}

export function usePlayer(): PlayerApi {
  const value = useContext(PlayerContext)
  if (!value) throw new Error('usePlayer must be used inside a PlayerProvider')
  return value
}
