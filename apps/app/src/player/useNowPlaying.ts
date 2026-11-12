import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { PlaybackEngine, ServerConnection } from '@selfmp3/client'

import type { PlayerApi } from './PlayerProvider'
import {
  positionJumped,
  SEEK_STEP_SECONDS,
  type ProgressStore,
  type ReportedPosition,
} from './progress.model'
import { nowPlayingArtwork, type ArtSources } from './nowPlayingArt.model'
import { artAddress } from '../api/mediaAddress.model'
import { mediaSourcesFor } from '../api/mediaSources'
import { useConnection } from '../connection/ConnectionProvider'
import { coverFor, coversVersion, KEPT_COVER_SIZE, subscribeCovers } from '../offline/covers'
import { mediaSession } from '../ports/mediaSession'

/**
 * Tell the operating system what is playing: Control Center and the Dock in
 * the installed app through the media session, the lock screen and Control
 * Center on a phone through the engine, nothing in a tab that has no media
 * session. The artwork is chosen the same way for both (`nowPlayingArtwork`).
 *
 * On a phone the native engine fills the card from the metadata the player
 * already hands it, and two writers would fight over one card: it only hears
 * here when the playing song's cover arrives or its words change. On the web
 * this is `navigator.mediaSession`, which is the media keys, the Now Playing
 * card in Control Center, and — through the shell — the Dock menu and the
 * power-save blocker.
 *
 * The actions are set once and read through a ref. They are functions the
 * player rebuilds when its queue changes, and handing Chromium a new set of
 * handlers several times a song made the card flicker its buttons.
 */
export function useNowPlaying(
  player: PlayerApi,
  progress: ProgressStore,
  engine: PlaybackEngine,
): void {
  const { connection, fromCloud } = useConnection()
  const latest = useRef(player)
  useEffect(() => {
    latest.current = player
  })

  useEffect(() => {
    if (!mediaSession.available) return
    mediaSession.setActions({
      play: () => {
        if (!latest.current.isPlaying) latest.current.toggle()
      },
      pause: () => {
        if (latest.current.isPlaying) latest.current.toggle()
      },
      next: () => latest.current.next(),
      previous: () => latest.current.previous(),
      seekTo: seconds => latest.current.seekTo(seconds),
      seekBy: delta => latest.current.seekBy(delta || SEEK_STEP_SECONDS),
    })
    return () => mediaSession.setActions(null)
  }, [])

  const { current, isPlaying } = player

  /*
   * The playing song's kept cover is read when the covers change, not on every
   * render, and one song's rather than a map of every cover on the device to
   * look one up in. Read again whenever a cover arrives. The covers already on
   * disk are read in at launch and announced once, and a subscription made in
   * an effect could miss that — then every song was shown with the server's
   * address all session. `useSyncExternalStore` checks the version again once
   * subscribed.
   */
  const coversSeen = useSyncExternalStore(subscribeCovers, coversVersion, coversVersion)
  const keptCover = useMemo(
    () => (current ? coverFor(current.id) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `coversSeen` is not read, but it is why the cover is looked up again
    [current, coversSeen],
  )
  const artwork = useMemo(
    () =>
      current ? nowPlayingArtwork(current, artSources(keptCover, connection, fromCloud)) : null,
    [current, keptCover, connection, fromCloud],
  )

  useEffect(() => {
    mediaSession.setNowPlaying(
      current === null
        ? null
        : {
            title: current.title,
            artist: current.artist,
            album: current.album,
            artwork,
            duration: current.duration,
          },
    )
  }, [current, artwork])

  useEffect(() => {
    mediaSession.setPlaying(isPlaying)
  }, [isPlaying])

  /*
   * The position, only when the card's own clock would be wrong.
   *
   * Chromium runs the card's clock from the last position it was given, at
   * normal speed, so a tick that agrees with that clock tells it nothing — and
   * every tick is a validation and, in the installed app, a round trip through
   * the OS. Told instead when play, pause or the song change (this effect
   * running again), when the length becomes known, and when the position jumps
   * further than the time that passed explains — a seek.
   */
  const songId = current?.id ?? null
  const songDuration = current?.duration ?? 0
  useEffect(() => {
    if (!mediaSession.available) return undefined
    let last: ReportedPosition | null = null
    let lastDuration = -1
    const report = (): void => {
      const { position, duration } = progress.get()
      lastDuration = duration
      mediaSession.setPosition(position, duration > 0 ? duration : songDuration)
      last = { position, at: Date.now(), playing: isPlaying }
    }
    report()
    return progress.subscribe(() => {
      const { position, duration } = progress.get()
      if (
        last === null ||
        duration !== lastDuration ||
        positionJumped(last, position, Date.now())
      ) {
        report()
      }
    })
  }, [progress, isPlaying, songId, songDuration])

  // The phone's card is the engine's: it hears here when the playing song's
  // cover arrives or its words change, and sends only what did.
  const title = current?.title
  const artist = current?.artist
  const album = current?.album
  useEffect(() => {
    if (songId !== null) engine.refreshNowPlaying?.(songId)
  }, [engine, songId, title, artist, album, artwork])
}

/** Where the Now Playing card may take a cover from: a copy here, or this library's address. */
export function artSources(
  kept: string | undefined,
  connection: ServerConnection | null,
  fromCloud: boolean,
): ArtSources {
  const sources = mediaSourcesFor(connection, fromCloud, KEPT_COVER_SIZE)
  return { kept, remoteArt: (songId, rev) => artAddress(songId, rev, sources) }
}
