import { useEffect, useRef } from 'react'
import { useGlobalSearchParams } from 'expo-router'
import { useLibrary } from '@selfmp3/client'
import { useDownloads } from '../offline/DownloadsProvider'
import { prefs } from '../ports/prefs'
import { useConnection } from '../connection/ConnectionProvider'
import { usePlayer, type PlayerApi } from './PlayerProvider'
import { createValueStore } from '../state/valueStore.model'
import { useValueStore } from '../state/useValueStore'
import {
  comingBack,
  launchPlayback,
  parseSession,
  POSITION_KEY,
  positionNote,
  SESSION_KEY,
  sessionFromQueue,
  withLatestPosition,
} from './session.model'

/** While playing, how often the position is written down. */
const SAVE_EVERY_MS = 5_000

/**
 * What coming back did this launch: not decided yet, or decided — with the
 * song this device brought back of its own, or null when it brought none.
 *
 * The resume toast waits for this. Offering another device's song while this
 * one is still restoring its own raced the restore, and main showed "Continue
 * オリオン" beside a bar that had just come back to アイドル.
 */
type PlaybackMemory =
  { readonly settled: false } | { readonly settled: true; readonly restoredSongId: number | null }

const memory = createValueStore<PlaybackMemory>({ settled: false })

function settle(restoredSongId: number | null): void {
  memory.set({ settled: true, restoredSongId })
}

/** Whether this launch has finished coming back, and to which song. */
export function usePlaybackMemoryState(): PlaybackMemory {
  return useValueStore(memory)
}

/**
 * The position is read from the player when it is written, not subscribed to:
 * this runs in the root shell, and subscribing re-rendered the whole frame on
 * every tick to copy a number nobody drew.
 *
 * Only once this launch has had a song of its own (`owns`): until then what is
 * written down is the last launch's, still to be come back to, and the empty
 * queue every launch starts with would write over it. Opened offline, the
 * saved song could not load, and the next refresh wrote "nothing" over it for
 * good (R4 web-cloud m1b).
 */
function writeSession(player: PlayerApi): void {
  const session = sessionFromQueue(player.queue, player.getPosition(), player.source)
  prefs.set(SESSION_KEY, session ? JSON.stringify(session) : '')
  writePosition(player)
}

/** Only how far in: what the clock moves, written every few seconds on its own. */
function writePosition(player: PlayerApi): void {
  prefs.set(POSITION_KEY, positionNote(player.queue, player.getPosition()) ?? '')
}

/**
 * Comes back to what this device was playing when the app opens again, and
 * keeps writing it down while it plays (`session.model.ts`).
 *
 * The song is loaded paused, where it was: opening a page never starts audio
 * by itself. Opened out of reach, it waits and comes back once its song can
 * play; a song that could not start without a question is left unloaded
 * rather than greeting the person with a dialog (`comingBack`).
 */
export function usePlaybackMemory(): void {
  const player = usePlayer()
  const library = useLibrary()
  const { blockFor, streamBlocked } = useDownloads()
  const { status } = useConnection()
  const { song: addressSong } = useGlobalSearchParams<{ song?: string }>()
  const restored = useRef(false)
  // This launch has had a song in the player: what is written down is its own now.
  const owns = useRef(false)
  const latest = useRef(player)
  useEffect(() => {
    latest.current = player
  }, [player])

  // Once, when the library is known; again while it waits for its song to be
  // in reach, each time the reach changes (`streamBlocked`, not read here, is
  // what changes when the bucket answers again).
  useEffect(() => {
    if (restored.current || status !== 'ready' || !library.data) return
    const now = latest.current
    // Something is already loaded: a handoff, or a song started meanwhile.
    if (now.current) {
      restored.current = true
      settle(null)
      return
    }
    const known = new Set(library.data.songs.map(song => song.id))
    const saved = withLatestPosition(parseSession(prefs.get(SESSION_KEY)), prefs.get(POSITION_KEY))
    const launch = launchPlayback(saved, addressSong, known)
    const songId = launch ? launch.queueIds[launch.index] : undefined
    const step = songId === undefined ? 'leave' : comingBack(launch, blockFor(songId))
    // Not settled while waiting: another device's song is out of reach too,
    // and offering it first would race this one coming back.
    if (step === 'wait') return
    restored.current = true
    if (step === 'leave' || !launch || songId === undefined) {
      settle(null)
      return
    }
    // In the order it was in: `false` keeps a shuffled queue from being shuffled again.
    now.playFrom(launch.queueIds, launch.index, {
      shuffle: false,
      position: launch.position,
      autoplay: false,
      source: launch.source,
    })
    settle(songId)
  }, [status, library.data, addressSong, blockFor, streamBlocked])

  // Whenever the queue, the song or play/pause changes, and every few seconds
  // while playing. Not before this launch has had a song (`writeSession`).
  // One played while coming back still waited is this launch's own: that is
  // decided, and nothing comes back over it.
  const queue = player.queue
  const songId = player.current?.id ?? null
  const playing = player.isPlaying
  const source = player.source
  useEffect(() => {
    if (songId !== null) owns.current = true
    if (!owns.current) return undefined
    if (!restored.current) {
      restored.current = true
      settle(null)
    }
    writeSession(latest.current)
    if (!playing) return undefined
    const timer = setInterval(() => writePosition(latest.current), SAVE_EVERY_MS)
    return () => clearInterval(timer)
  }, [queue, songId, playing, source])

  // A browser tab closing or refreshing: the position as it is right now.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
      return undefined
    }
    const onHide = (): void => {
      if (owns.current) writeSession(latest.current)
    }
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [])
}
