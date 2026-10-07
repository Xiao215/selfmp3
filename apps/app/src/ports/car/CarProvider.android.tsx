import { useEffect, useRef } from 'react'
import type { ReactNode, RefObject } from 'react'
import { useLibrary, usePlaylistSongIds } from '@selfmp3/client'
import { usePlayerCommands } from '../../player/PlayerProvider'
import { buildBrowseTree, type BrowseTree } from './browseTree'
import { connectAndroidAuto } from './androidAuto'

/**
 * Keeps the car's view of the library in step, on Android.
 *
 * Android Auto is the one integration there is; see `androidAuto.ts` for what
 * of it can be wired up today. Elsewhere `CarProvider.tsx` does nothing.
 *
 * The car asks for a song by id or by a spoken name, and both are answered
 * from a `BrowseTree` built when it asks, from the library and each
 * playlist's members as they stand then. The members are a request per
 * playlist, made through the same query the playlist pages use — so a cloud
 * library answers from this device's copy, and a server that is away answers
 * from the copy kept of each list.
 */
export function CarProvider({ children }: { children: ReactNode }): ReactNode {
  const library = useLibrary()
  const player = usePlayerCommands()
  const playlists = library.data?.playlists ?? []
  // Read when the car asks, not dependencies of the wiring: the car connects
  // once and its handlers must see the library as it is when a row is chosen.
  const members = useRef(new Map<number, readonly number[]>())
  const libraryNow = useRef(library.data)
  useEffect(() => {
    libraryNow.current = library.data
  }, [library.data])

  useEffect(() => {
    const getTree = (): BrowseTree =>
      buildBrowseTree({
        songs: libraryNow.current?.songs ?? [],
        playlists: libraryNow.current?.playlists ?? [],
        playlistSongIds: Object.fromEntries(members.current),
      })
    return connectAndroidAuto(getTree, {
      onPlay: (songIds, startIndex) => player.playFrom(songIds, startIndex),
    })
  }, [player])

  return (
    <>
      {playlists.map(playlist => (
        <PlaylistMembers key={playlist.id} playlistId={playlist.id} into={members} />
      ))}
      {children}
    </>
  )
}

/** One playlist's members, kept where the car's tree is built from. Draws nothing. */
function PlaylistMembers({
  playlistId,
  into,
}: {
  playlistId: number
  into: RefObject<Map<number, readonly number[]>>
}): ReactNode {
  const { data } = usePlaylistSongIds(playlistId)
  useEffect(() => {
    if (!data) return undefined
    const kept = into.current
    kept.set(playlistId, data.songIds)
    return () => {
      kept.delete(playlistId)
    }
  }, [data, playlistId, into])
  return null
}
