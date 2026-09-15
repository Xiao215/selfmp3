import { useEffect, useMemo, useRef } from 'react'
import type { Library } from '@selfmp3/shared'
import { isDownloaded, runLimited, useLibrary } from '@selfmp3/client'
import { api, mediaUrlFor } from '../api/client'
import { useConnection } from '../connection/ConnectionProvider'
import { ensureCover, ensureServerCover, KEPT_COVER_SIZE } from './covers'
import { useDownloads } from './DownloadsProvider'
import { hasCachedLyrics, writeCachedLyrics } from './lyricsCache'
import { hasCachedMotion, writeCachedMotion } from './motionCache'
import { writeCachedPlaylist } from './playlistCache'

/**
 * What the library snapshot does not carry, kept on this device anyway.
 *
 * The library answer names every song and playlist but holds no pictures, no
 * words and no playlist members: each is a request of its own. This pass runs
 * once per change to the library's contents, while the server is answering,
 * and asks for them in the background, a few at a time, so a phone that has
 * seen its server once looks and works the same when the server is away:
 *
 *  - every song's cover, downloaded or not — a row wants its picture either way;
 *  - every playlist's members, so a playlist opens offline;
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
 * a file check on a phone — and perhaps a fetch; thousands of them in the same
 * instant was what a first pass used to be.
 */
const AT_ONCE = 4

/**
 * What a pass depends on, as a short string: which songs, at which revision,
 * and which playlists, as they last changed.
 *
 * Not `generatedAt`, which named the pass before. A server stamps each answer
 * with the time it was made, so every refetch looked like a new library and
 * started the whole pass again; a cloud library stamps its snapshot, which can
 * stay put while a revision underneath it moves. This changes exactly when
 * there is something new to keep.
 */
function contentsKey(library: Library): string {
  // FNV-1a, 32-bit: a few thousand songs hash in well under a frame, and the
  // key stays a few bytes instead of the whole library as a string.
  let hash = 0x811c9dc5
  const mix = (text: string): void => {
    for (let at = 0; at < text.length; at += 1) {
      hash ^= text.charCodeAt(at)
      hash = Math.imul(hash, 0x01000193)
    }
  }
  for (const song of library.songs) mix(`${song.id}:${song.rev ?? ''}:${song.hasArt ? 1 : 0};`)
  for (const playlist of library.playlists) {
    mix(`p${playlist.id}:${playlist.updatedAt}:${playlist.songCount};`)
  }
  return `${library.songs.length}.${library.playlists.length}.${(hash >>> 0).toString(36)}`
}

export function useKeepAlongside(): void {
  const library = useLibrary()
  const { state, installed } = useDownloads()
  const { connection, fromCloud } = useConnection()
  // The key of the last pass that ran to the end.
  const done = useRef<string | null>(null)

  const data = library.data
  // A copy saved on this device is shown dated 0 while the server is asked; it says
  // nothing about whether the server answers, so the pass waits for a real answer.
  const reachable = data !== undefined && !library.isError && library.dataUpdatedAt !== 0
  const key = useMemo(() => (data === undefined ? null : contentsKey(data)), [data])

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
    const isCancelled = (): boolean => cancelled

    void (async () => {
      const songsDone = await runLimited(
        library.songs,
        AT_ONCE,
        async song => {
          if (song.hasArt) {
            if (fromCloud) await ensureCover(song.id)
            else if (connection) {
              // Waited on, so the server is asked for AT_ONCE covers at a time.
              await ensureServerCover(
                song.id,
                song.rev,
                mediaUrlFor(connection).art(song.id, song.rev, KEPT_COVER_SIZE),
              )
            }
          }
          // Words go with a kept file: an installed app's downloads, or a
          // browser's played copies, which the download queue also keeps.
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
      for (const playlist of library.playlists) {
        if (cancelled) return
        try {
          writeCachedPlaylist(await api.playlistSongs(playlist.id))
        } catch {
          // Likewise.
        }
      }
      // Only a pass that ran to the end counts. One called off — the server
      // changed, the app went offline — is run again when the effect next can.
      if (!cancelled) done.current = key
    })()

    return () => {
      cancelled = true
    }
  }, [installed, reachable, key, connection, fromCloud])
}
