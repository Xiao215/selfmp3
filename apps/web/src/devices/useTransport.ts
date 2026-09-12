import { useCallback, useEffect, useMemo, useState } from 'react'
import { extrapolatePosition, type Device, type Song } from '@selfmp3/shared'
import { usePlayer } from '../player/PlayerProvider.js'
import { useLibrary } from '../lib/queries.js'
import { useDeviceContext } from './DevicesProvider.js'

/**
 * What the transport controls are pointed at.
 *
 * Normally the local player. When remote control is on, the same shape backed
 * by commands and by the target device's heartbeats — so the player bar and
 * the now-playing screen need one hook swap rather than a second set of
 * buttons that happen to look the same.
 *
 * `remote` being non-null is the signal to the UI that it should say so.
 */
export interface Transport {
  readonly remote: Device | null
  readonly song: Song | null
  readonly playing: boolean
  readonly currentTime: number
  readonly duration: number
  readonly volume: number
  readonly toggle: () => void
  readonly next: () => void
  readonly previous: () => void
  readonly seek: (seconds: number) => void
  readonly setVolume: (volume: number) => void
}

/** How often the remote scrubber is re-extrapolated between heartbeats. */
const TICK_MS = 500

export function useTransport(): Transport {
  const player = usePlayer()
  const { remote, send } = useDeviceContext()
  const { data: library } = useLibrary()

  /* When this browser last saw a new state from the remote device, locally. */
  const heardAt = useMemo(() => Date.now(), [remote?.state.updatedAt])

  const remoteSong = useMemo(() => {
    const songId = remote?.state.songId
    if (songId == null) return null
    return library?.songs.find(song => song.id === songId) ?? null
  }, [remote?.state.songId, library])

  // A remote device reports every ten seconds; without a local tick the
  // scrubber would crawl forward in ten-second jumps.
  const [, tick] = useState(0)
  useEffect(() => {
    if (!remote?.state.playing) return
    const timer = setInterval(() => tick(value => value + 1), TICK_MS)
    return () => clearInterval(timer)
  }, [remote?.state.playing])

  const remoteId = remote?.id
  const toggle = useCallback(() => {
    if (remoteId === undefined) player.toggle()
    else send(remoteId, { type: 'toggle' })
  }, [remoteId, player, send])

  const next = useCallback(() => {
    if (remoteId === undefined) player.next()
    else send(remoteId, { type: 'next' })
  }, [remoteId, player, send])

  const previous = useCallback(() => {
    if (remoteId === undefined) player.previous()
    else send(remoteId, { type: 'prev' })
  }, [remoteId, player, send])

  const seek = useCallback(
    (seconds: number) => {
      if (remoteId === undefined) player.seek(seconds)
      else send(remoteId, { type: 'seek', position: seconds })
    },
    [remoteId, player, send],
  )

  const setVolume = useCallback(
    (volume: number) => {
      if (remoteId === undefined) player.setVolume(volume)
      else send(remoteId, { type: 'setVolume', volume })
    },
    [remoteId, player, send],
  )

  if (!remote) {
    return {
      remote: null,
      song: player.current,
      playing: player.playing,
      currentTime: player.currentTime,
      duration: player.duration,
      volume: player.muted ? 0 : player.volume,
      toggle,
      next,
      previous,
      seek,
      setVolume,
    }
  }

  const duration = remoteSong?.duration ?? 0
  return {
    remote,
    song: remoteSong,
    playing: remote.state.playing,
    // Measured from when this browser received the heartbeat, by its own
    // clock. `state.updatedAt` is the other device's clock, and the two
    // disagreeing by a few seconds is ordinary — subtracting one from the
    // other put the scrubber wherever the difference happened to be.
    currentTime: extrapolatePosition(remote.state, Date.now(), duration, heardAt),
    duration,
    volume: remote.state.volume ?? 1,
    toggle,
    next,
    previous,
    seek,
    setVolume,
  }
}
