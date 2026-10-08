import { useEffect, useMemo, useRef, useState } from 'react'
import type { Library } from '@selfmp3/shared'
import { isDownloaded, runLimited, useLibrary } from '@selfmp3/client'
import { api, mediaUrlFor } from '../api/client'
import { useConnection } from '../connection/ConnectionProvider'
import { library as cloudLibrary } from '../replica'
import {
  ensureCover,
  ensurePicture,
  ensureServerCover,
  KEPT_COVER_SIZE,
  sweepPictures,
} from './covers'
import { useDownloads } from './DownloadsProvider'
import { hasCachedLyrics, writeCachedLyrics } from './lyricsCache'
import { hasCachedMotion, writeCachedMotion } from './motionCache'
import { writeCachedPlaylist } from './playlistCache'

/**
 * What the library snapshot does not carry, kept on this device anyway.
 *
 * The library answer names every song and playlist but holds no pictures, no
 * words and no playlist members: each is a request of its own. Two passes ask
 * for them in the background while the server is answering, each once per
 * change to what it keeps, so a phone that has seen its server once looks and
 * works the same when the server is away:
 *
 *  - every song's cover, downloaded or not — a row wants its picture either way —
 *    and, from the bucket, every artist's picture. One that could not be had
 *    (the bucket's daily cap, say) is asked for again a while later, not left
 *    until the library next changes; once every one is here, the pictures the
 *    library no longer names are deleted (`sweepPictures`);
 *  - every playlist's members, so a playlist opens offline — a pass of its
 *    own, since a playlist's songs change without any song changing;
 *  - the words of every downloaded song. A download fetches its own words as
 *    it goes (ports/downloadStorage.ts); this catches songs downloaded before
 *    the app kept words, and words edited on the server since;
 *  - the motion curve of every downloaded song, for the same reason, and for
 *    songs the server had not analysed yet when they were downloaded.
 *
 * A song with no words is a 404 and is simply skipped; it is asked again next
 * time. Everything here is best effort: a request that fails is left for the
 * next pass, and nothing waits on it.
 */

/**
 * Songs worked on at once. Each is a cover check — a shell call on a computer,
 * a file check on a phone — and perhaps a fetch, so they are not all started
 * at once.
 */
const AT_ONCE = 4

/** How long after a pass that could not fetch every picture the next one starts. */
const RETRY_MISSING_MS = 10 * 60_000

/**
 * How long the songs pass works before it lets the phone draw and take taps.
 *
 * A song whose cover and words are already here is answered without waiting on
 * anything — a file check is synchronous — so a pass over a library kept
 * whole never left the JavaScript thread on its own: 1,500 songs held it for
 * seven seconds on the simulator.
 */
const SLICE_MS = 8

/**
 * FNV-1a, 32-bit, of the parts given: a few thousand songs hash in well under
 * a frame, and the key stays a few bytes instead of the whole library as a
 * string.
 */
function hashOf(count: number, parts: Iterable<string>): string {
  let hash = 0x811c9dc5
  for (const text of parts) {
    for (let at = 0; at < text.length; at += 1) {
      hash ^= text.charCodeAt(at)
      hash = Math.imul(hash, 0x01000193)
    }
  }
  return `${count}.${(hash >>> 0).toString(36)}`
}

/**
 * What the songs pass depends on, as a short string: which songs, at which
 * revision, and which artists' pictures.
 *
 * Not `generatedAt`, which named the pass before. A server stamps each answer
 * with the time it was made, so every refetch looked like a new library and
 * started the whole pass again; a cloud library stamps its snapshot, which can
 * stay put while a revision underneath it moves. Not the playlists either:
 * ticking a tag that a live playlist follows changes how many songs it has,
 * and that started the pass over every song again, after every tick.
 */
function songsKey(library: Library, artists: readonly { banner: string }[]): string {
  return hashOf(library.songs.length, [
    ...library.songs.map(song => `${song.id}:${song.rev ?? ''}:${song.hasArt ? 1 : 0};`),
    // An artist's picture arriving changes no song: it is a pass's worth too.
    ...artists.map(artist => `a${artist.banner};`),
  ])
}

/** What the playlists pass depends on: which playlists, as they last changed. */
function playlistsKey(library: Library): string {
  return hashOf(
    library.playlists.length,
    library.playlists.map(
      playlist => `p${playlist.id}:${playlist.updatedAt}:${playlist.songCount};`,
    ),
  )
}

/**
 * Wait for the next turn of the event loop once this much work has run since
 * the last. Awaiting a promise that is already settled does not do that: it
 * carries straight on, ahead of every tap and redraw waiting.
 */
function slices(ms: number): () => Promise<void> {
  let since = Date.now()
  return async () => {
    if (Date.now() - since < ms) return
    await new Promise(resolve => setTimeout(resolve, 0))
    since = Date.now()
  }
}

export function useKeepAlongside(): void {
  const library = useLibrary()
  const { state, installed } = useDownloads()
  const { connection, fromCloud } = useConnection()
  // The keys of the last passes that ran to the end.
  const done = useRef<string | null>(null)
  const playlistsDone = useRef<string | null>(null)
  // Bumped to run a pass again that could not fetch every picture.
  const [retry, setRetry] = useState(0)

  const data = library.data
  // A copy saved on this device is shown dated 0 while the server is asked; it says
  // nothing about whether the server answers, so the pass waits for a real answer.
  const reachable = data !== undefined && !library.isError && library.dataUpdatedAt !== 0
  const key = useMemo(
    () =>
      data === undefined
        ? null
        : songsKey(data, fromCloud ? (cloudLibrary.cloudPicturesNow()?.artists ?? []) : []),
    [data, fromCloud],
  )
  const listsKey = useMemo(() => (data === undefined ? null : playlistsKey(data)), [data])

  /*
   * Read when a pass reaches them, not dependencies of it. A download finishing
   * changes the index, and with the index a dependency that called the running
   * pass off — while the check below, already marked, kept the next one from
   * starting. Words and playlists after the first finished download were never
   * kept. Declared before the pass so a new library is here when its pass starts.
   */
  const latest = useRef({ data, index: state.index })
  useEffect(() => {
    latest.current = { data, index: state.index }
  }, [data, state.index])

  useEffect(() => {
    if (!reachable || key === null) return undefined
    if (done.current === key) return undefined
    const library = latest.current.data
    if (library === undefined) return undefined
    let cancelled = false
    let again: ReturnType<typeof setTimeout> | null = null
    const isCancelled = (): boolean => cancelled
    // Pictures this pass could not fetch.
    let missing = 0

    void (async () => {
      const breathe = slices(SLICE_MS)
      const songsDone = await runLimited(
        library.songs,
        AT_ONCE,
        async song => {
          await breathe()
          if (cancelled) return
          if (song.hasArt) {
            if (fromCloud) {
              if (!(await ensureCover(song.id))) missing++
            } else if (connection) {
              // Waited on, so the server is asked for AT_ONCE covers at a time.
              await ensureServerCover(
                song.id,
                song.rev,
                mediaUrlFor(connection).art(song.id, song.rev, KEPT_COVER_SIZE),
              )
            }
          }
          // Words go with a kept file, which only an installed app has: a
          // browser tab streams, and asks for the words when it plays.
          if (!installed || !isDownloaded(latest.current.index, song.id)) return
          if (!cancelled && !(await hasCachedLyrics(song.id))) {
            try {
              writeCachedLyrics(song.id, await api.lyrics(song.id))
            } catch {
              // No words, or the server went away mid-pass: the next pass asks again.
            }
          }
          if (!cancelled && !(await hasCachedMotion(song.id))) {
            try {
              writeCachedMotion(song.id, await api.motion(song.id))
            } catch {
              // Not analysed yet, or the server went away: likewise.
            }
          }
        },
        isCancelled,
      )
      if (!songsDone) return
      const pictures = fromCloud ? cloudLibrary.cloudPicturesNow() : null
      if (pictures) {
        const artistsDone = await runLimited(
          pictures.artists.flatMap(artist => [artist.banner, artist.portrait]),
          AT_ONCE,
          async key => {
            if (!(await ensurePicture(key))) missing++
          },
          isCancelled,
        )
        if (!artistsDone) return
      }
      if (cancelled) return
      if (missing > 0) {
        again = setTimeout(() => setRetry(count => count + 1), RETRY_MISSING_MS)
        return
      }
      // Every picture the library names is here: what it no longer names is
      // not wanted, and is never looked at again. Asked of the library as it
      // is now, so a cover it has named since is not swept.
      const named = fromCloud ? cloudLibrary.cloudPicturesNow() : null
      // A library naming no cover at all is one not loaded, more likely than
      // one with none: nothing is swept on its word.
      if (named && named.covers.size > 0) {
        const keys = new Set(named.covers)
        for (const artist of named.artists) keys.add(artist.banner).add(artist.portrait)
        await sweepPictures(keys).catch(() => 0)
      }
      // Only a pass that ran to the end counts. One called off — the server
      // changed, the app went offline — is run again when the effect next can.
      if (!cancelled) done.current = key
    })()

    return () => {
      cancelled = true
      if (again) clearTimeout(again)
    }
  }, [installed, reachable, key, connection, fromCloud, retry])

  useEffect(() => {
    if (!reachable || listsKey === null) return undefined
    if (playlistsDone.current === listsKey) return undefined
    const library = latest.current.data
    if (library === undefined) return undefined
    let cancelled = false

    void (async () => {
      for (const playlist of library.playlists) {
        if (cancelled) return
        try {
          writeCachedPlaylist(await api.playlistSongs(playlist.id))
        } catch {
          // No answer, or the server went away mid-pass: the next pass asks again.
        }
      }
      if (!cancelled) playlistsDone.current = listsKey
    })()

    return () => {
      cancelled = true
    }
  }, [reachable, listsKey, connection, fromCloud])
}
