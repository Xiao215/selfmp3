import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useGlobalSearchParams } from 'expo-router'
import { useLibrary } from '@selfmp3/client'
import { useDownloads } from '../offline/DownloadsProvider'
import { prefs } from '../ports/prefs'
import { useConnection } from '../connection/ConnectionProvider'
import { usePlayer, type PlayerApi } from './PlayerProvider'
import { launchPlayback, parseSession, SESSION_KEY, sessionFromQueue } from './session.model'

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
export type PlaybackMemory =
  { readonly settled: false } | { readonly settled: true; readonly restoredSongId: number | null }

let memory: PlaybackMemory = { settled: false }
const memoryListeners = new Set<() => void>()

function settle(restoredSongId: number | null): void {
  memory = { settled: true, restoredSongId }
  for (const listener of memoryListeners) listener()
}

function subscribeMemory(listener: () => void): () => void {
  memoryListeners.add(listener)
  return () => {
    memoryListeners.delete(listener)
  }
}

/** Whether this launch has finished coming back, and to which song. */
export function usePlaybackMemoryState(): PlaybackMemory {
  return useSyncExternalStore(
    subscribeMemory,
    () => memory,
    () => memory,
  )
}

/**
 * The position is read from the player when it is written, not subscribed to:
 * this runs in the root shell, and subscribing re-rendered the whole frame on
 * every tick to copy a number nobody drew.
 */
function writeSession(player: PlayerApi): void {
  const session = sessionFromQueue(player.queue, player.getPosition(), Date.now())
  prefs.set(SESSION_KEY, session ? JSON.stringify(session) : '')
}

/**
 * Comes back to what this device was playing when the app opens again, and
 * keeps writing it down while it plays (`session.model.ts`).
 *
 * The song is loaded paused, where it was: opening a page never starts audio
 * by itself. A song that could not start here without a question — not
 * downloaded in a cloud library on a phone, or offline — is left unloaded
 * rather than greeting the person with a dialog.
 */
export function usePlaybackMemory(): void {
  const player = usePlayer()
  const library = useLibrary()
  const { mayPlay } = useDownloads()
  const { status } = useConnection()
  const { song: addressSong } = useGlobalSearchParams<{ song?: string }>()
  const restored = useRef(false)
  const latest = useRef(player)
  useEffect(() => {
    latest.current = player
  }, [player])

  // Once, when the library is known.
  useEffect(() => {
    if (restored.current || status !== 'ready' || !library.data) return
    restored.current = true
    const now = latest.current
    // Something is already loaded: a handoff, or a song started meanwhile.
    if (now.current) {
      settle(null)
      return
    }
    const known = new Set(library.data.songs.filter(song => !song.missing).map(song => song.id))
    const launch = launchPlayback(parseSession(prefs.get(SESSION_KEY)), addressSong, known)
    const songId = launch ? launch.queueIds[launch.index] : undefined
    if (!launch || songId === undefined || !mayPlay(songId)) {
      settle(null)
      return
    }
    // In the order it was in: `false` keeps a shuffled queue from being shuffled again.
    now.playFrom(launch.queueIds, launch.index, false, launch.position, false)
    settle(songId)
  }, [status, library.data, addressSong, mayPlay])

  // Whenever the queue, the song or play/pause changes, and every few seconds
  // while playing. Not before coming back, which would write over what is to
  // be come back to with the empty queue every launch starts with.
  const queue = player.queue
  const songId = player.current?.id ?? null
  const playing = player.isPlaying
  useEffect(() => {
    if (!restored.current) return undefined
    writeSession(latest.current)
    if (!playing) return undefined
    const timer = setInterval(() => writeSession(latest.current), SAVE_EVERY_MS)
    return () => clearInterval(timer)
  }, [queue, songId, playing])

  // A browser tab closing or refreshing: the position as it is right now.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
      return undefined
    }
    const onHide = (): void => {
      if (restored.current) writeSession(latest.current)
    }
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [])
}
