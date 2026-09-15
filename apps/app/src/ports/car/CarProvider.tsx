import { useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { useQueries } from '@tanstack/react-query'
import { api } from '../../api/client'
import { queryKeys, useLibrary } from '@selfmp3/client'
import { usePlayer } from '../../player/PlayerProvider'
import { useConnection } from '../../server/ConnectionProvider'
import { buildBrowseTree, type BrowseTree } from './browseTree'
import { connectAndroidAuto } from './androidAuto'

/**
 * Keeps the car's view of the library in sync, on both platforms.
 *
 * Renders nothing. It is a component only so it can sit inside the provider
 * tree and see the library, the player and the connection.
 *
 * The tree is handed to the car integrations behind a getter rather than as a
 * value: the tree is built once when the head unit connects and then
 * live on the native side, so they must read the *current* tree when a row is
 * tapped rather than closing over whatever existed at connection time.
 */
export function CarProvider({ children }: { children: ReactNode }): ReactNode {
  const { connection } = useConnection()
  const library = useLibrary()
  const player = usePlayer()

  const playlists = useMemo(() => library.data?.playlists ?? [], [library.data])

  // Playlist contents are a separate endpoint per playlist. They are small,
  // and the car needs them all up front, so they are fetched together.
  const playlistQueries = useQueries({
    queries: playlists.map(playlist => ({
      queryKey: queryKeys.playlistSongs(playlist.id),
      enabled: connection !== null,
      staleTime: 5 * 60_000,
      queryFn: async () => {
        if (!connection) throw new Error('no server configured')
        return api.playlistSongs(playlist.id)
      },
    })),
  })

  // `useQueries` returns a fresh array every render, so the memo below keys off
  // the resolved contents instead. Rebuilding the tree is cheap; rebuilding it
  // sixty times a second is not.
  const playlistSignature = playlistQueries
    .map(query => (query.data ? `${query.data.playlistId}:${query.data.songIds.join(',')}` : ''))
    .join('|')

  const playlistSongIds = useMemo(() => {
    const map: Record<number, readonly number[]> = {}
    for (const part of playlistSignature.split('|')) {
      if (part.length === 0) continue
      const [id, ids] = part.split(':')
      if (id === undefined) continue
      map[Number(id)] = (ids ?? '')
        .split(',')
        .filter(value => value.length > 0)
        .map(Number)
    }
    return map
  }, [playlistSignature])

  const tree = useMemo<BrowseTree>(
    () =>
      buildBrowseTree({
        songs: library.data?.songs ?? [],
        playlists,
        playlistSongIds,
      }),
    [library.data, playlists, playlistSongIds],
  )

  // The car integrations are set up once and then live on the native side, so
  // they read these refs rather than closing over a render's values.
  const treeRef = useRef(tree)
  const playerRef = useRef(player)
  const connectionRef = useRef(connection)

  useEffect(() => {
    treeRef.current = tree
  }, [tree])

  useEffect(() => {
    playerRef.current = player
  }, [player])

  useEffect(() => {
    connectionRef.current = connection
  }, [connection])

  useEffect(() => {
    const getTree = (): BrowseTree => treeRef.current
    const onPlay = (songIds: readonly number[], startIndex: number): void => {
      playerRef.current.playFrom(songIds, startIndex)
    }

    const disconnectAndroidAuto = connectAndroidAuto(getTree, { onPlay })

    return () => {
      disconnectAndroidAuto()
    }
  }, [])

  return children
}
