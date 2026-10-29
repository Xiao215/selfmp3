import { useCallback, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { linkIdentity, plural, type CameWith, type ImportJob, type RoomSong } from '@selfmp3/shared'
import { queryKeys } from '@selfmp3/client'
import { apiFor } from '../../api/client'
import { useConnection } from '../../connection/ConnectionProvider'
import { noServer, viaKey } from '../../connection/via'
import { library as cloudLibrary } from '../../replica'
import { useSongsLanding } from '../import/useSongsLanding'
import { useServerDirect } from '../../connection/useServerDirect'
import { showFailure, showToast } from '../../ui/toast'

/** A song to get, and the friend it came from. */
export interface GetSong {
  readonly song: RoomSong
  readonly cameWith: CameWith | null
}

/**
 * Get it (docs/features/listen-together.md, G1): a friend's song brought
 * home, your own server importing it from the link it came from into your own
 * bucket. A room's song, a room that ended and a share link all offer it.
 */
export function useGetSongs(
  options: {
    readonly enabled?: boolean
    /** Follow the server's import queue, so each song's import can be drawn as it goes. */
    readonly watch?: boolean
  } = {},
): {
  /** Your library's computer answers, so Get it can be asked. */
  readonly reachable: boolean
  /** The source links asked for, while they import. */
  readonly getting: ReadonlySet<string>
  /**
   * Ask for these; true once the server has taken them. Each says who it came
   * from, which the song keeps (its page: "from Mia, in a room").
   */
  readonly get: (songs: readonly GetSong[]) => Promise<boolean>
  /** The latest import of the song from this link, while `watch` follows the queue. */
  readonly jobFor: (sourceUrl: string | null) => ImportJob | undefined
  /** Try a failed import again. */
  readonly retry: (job: ImportJob) => Promise<void>
} {
  const server = useServerDirect({ enabled: options.enabled ?? true })
  const [getting, setGetting] = useState<ReadonlySet<string>>(new Set())
  const connection = server.state === 'reachable' ? server.connection : null
  const api = useMemo(() => (connection ? apiFor(connection) : null), [connection])
  const queryClient = useQueryClient()
  const { fromCloud } = useConnection()

  // The Import page's own query of the same server's queue, so the two share
  // one poll: every second while anything imports, then not at all.
  const queue = useQuery({
    queryKey: viaKey(connection?.baseUrl, 'queue'),
    queryFn: () => (api ? api.importQueue() : noServer()),
    enabled: api !== null && options.watch === true,
    refetchInterval: query => {
      const data = query.state.data
      return data && (data.active > 0 || data.queued > 0) ? 1_000 : false
    },
  })
  // A song that landed is a song of yours: the library is asked again, as the
  // Import page asks it, so its row turns into one you can play.
  const look = useCallback(() => {
    if (fromCloud) cloudLibrary.markCloudLibraryStale()
    void queryClient.invalidateQueries({ queryKey: queryKeys.library })
  }, [fromCloud, queryClient])
  useSongsLanding(queue.data, connection?.baseUrl ?? 'here', look)

  const jobFor = useCallback(
    (sourceUrl: string | null): ImportJob | undefined => {
      const wanted = linkIdentity(sourceUrl)
      if (!wanted) return undefined
      // Newest first: a song got again after a failure is drawn as it is now.
      return [...(queue.data?.jobs ?? [])]
        .filter(job => linkIdentity(job.url) === wanted)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    },
    [queue.data],
  )

  const retry = async (job: ImportJob): Promise<void> => {
    if (!api) return
    try {
      await api.retryImport(job.id)
      void queryClient.invalidateQueries({ queryKey: viaKey(connection?.baseUrl, 'queue') })
    } catch (error) {
      showFailure('Couldn’t try it again', error)
    }
  }

  const get = async (asked: readonly GetSong[]): Promise<boolean> => {
    const wanted = asked.filter(({ song }) => song.sourceUrl !== null)
    if (wanted.length === 0) return false
    if (server.state !== 'reachable') {
      showToast('Get it needs your library’s computer, and it can’t be reached from here', 'warn')
      return false
    }
    const keys = wanted.map(({ song }) => song.sourceUrl ?? '')
    setGetting(before => new Set([...before, ...keys]))
    try {
      await apiFor(server.connection).importEnqueue({
        items: wanted.map(({ song, cameWith }) => ({
          url: song.sourceUrl ?? '',
          title: song.title,
          artist: song.artist,
          album: song.album,
          thumbnail: null,
          duration: song.duration,
          ...(cameWith ? { cameWith } : {}),
        })),
        tagIds: [],
        playlistId: null,
        createPlaylistName: null,
      })
      // Followed on the row itself where the queue is watched; said otherwise.
      if (options.watch) {
        void queryClient.invalidateQueries({ queryKey: viaKey(connection?.baseUrl, 'queue') })
      } else {
        showToast(
          wanted.length === 1
            ? `Getting “${wanted[0]?.song.title ?? ''}”. It arrives in your library as it imports.`
            : `Getting ${plural(wanted.length, 'song', 'songs')}. They arrive in your library as they import.`,
          'good',
        )
      }
      return true
    } catch (error) {
      setGetting(before => new Set([...before].filter(key => !keys.includes(key))))
      showFailure('Couldn’t get that', error)
      return false
    }
  }

  return { reachable: server.state === 'reachable', getting, get, jobFor, retry }
}
