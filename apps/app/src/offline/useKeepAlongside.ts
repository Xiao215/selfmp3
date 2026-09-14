import { useEffect, useRef } from 'react'
import { isDownloaded } from '@selfmp3/client'
import { useLibrary } from '../api/queries'
import { api, mediaUrlFor } from '../api/client'
import { useConnection } from '../server/ConnectionProvider'
import { ensureCover, ensureServerCover, KEPT_COVER_SIZE } from './covers'
import { useDownloads } from './DownloadsProvider'
import { hasCachedLyrics, writeCachedLyrics } from './lyricsCache'
import { writeCachedPlaylist } from './playlistCache'

/**
 * What the library snapshot does not carry, kept on this device anyway.
 *
 * The library answer names every song and playlist but holds no pictures, no
 * words and no playlist members: each is a request of its own. This pass runs
 * once per library answer, while the server is answering, and asks for them
 * in the background, one at a time, so a phone that has seen its Mac once
 * looks and works the same when the Mac is away:
 *
 *  - every song's cover, downloaded or not — a row wants its picture either way;
 *  - every playlist's members, so a playlist opens offline;
 *  - the words of every downloaded song. A download fetches its own words as
 *    it goes (ports/downloadStorage.ts); this catches songs downloaded before
 *    the app kept words, and words edited on the Mac since.
 *
 * A song with no words is a 404 and is simply skipped; it is asked again next
 * time. Everything here is best effort: a request that fails is left for the
 * next pass, and nothing waits on it.
 */
export function useKeepAlongside(): void {
  const library = useLibrary()
  const { state, installed } = useDownloads()
  const { connection, fromCloud } = useConnection()
  // The library's `generatedAt` names an answer; one pass per answer.
  const done = useRef<string | null>(null)

  const songs = library.data?.songs
  const playlists = library.data?.playlists
  const generatedAt = library.data?.generatedAt ?? null
  const reachable = library.data !== undefined && !library.isError
  const index = state.index

  useEffect(() => {
    if (!reachable || !songs || !playlists || generatedAt === null) return undefined
    if (done.current === generatedAt) return undefined
    done.current = generatedAt
    let cancelled = false

    void (async () => {
      for (const song of songs) {
        if (cancelled) return
        if (song.hasArt) {
          if (fromCloud) void ensureCover(song.id)
          else if (connection) {
            ensureServerCover(
              song.id,
              song.rev,
              mediaUrlFor(connection).art(song.id, song.rev, KEPT_COVER_SIZE),
            )
          }
        }
        // Words go with a kept file: an installed app's downloads, or a
        // browser's played copies, which the download queue also keeps.
        if (!installed || !isDownloaded(index, song.id)) continue
        if (await hasCachedLyrics(song.id)) continue
        try {
          writeCachedLyrics(song.id, await api.lyrics(song.id))
        } catch {
          // No words, or the server went away mid-pass: the next pass asks again.
        }
      }
      for (const playlist of playlists) {
        if (cancelled) return
        try {
          writeCachedPlaylist(await api.playlistSongs(playlist.id))
        } catch {
          // Likewise.
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [installed, reachable, songs, playlists, generatedAt, index, connection, fromCloud])
}
