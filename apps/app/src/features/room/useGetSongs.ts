import { useState } from 'react'
import { plural, type RoomSong } from '@selfmp3/shared'
import { failureText } from '@selfmp3/client'
import { apiFor } from '../../api/client'
import { useServerDirect } from '../../connection/useServerDirect'
import { showToast } from '../../ui/toast'

/**
 * Get it (docs/features/listen-together.md, G1): a friend's song brought
 * home, your own server importing it from the link it came from into your own
 * bucket. A room's song, a room that ended and a share link all offer it.
 */
export function useGetSongs(options: { readonly enabled?: boolean } = {}): {
  /** Your library's computer answers, so Get it can be asked. */
  readonly reachable: boolean
  /** The source links asked for, while they import. */
  readonly getting: ReadonlySet<string>
  /** Ask for these; true once the server has taken them. */
  readonly get: (songs: readonly RoomSong[]) => Promise<boolean>
} {
  const server = useServerDirect({ enabled: options.enabled ?? true })
  const [getting, setGetting] = useState<ReadonlySet<string>>(new Set())

  const get = async (songs: readonly RoomSong[]): Promise<boolean> => {
    const wanted = songs.filter(song => song.sourceUrl !== null)
    if (wanted.length === 0) return false
    if (server.state !== 'reachable') {
      showToast('Get it needs your library’s computer, and it can’t be reached from here', 'warn')
      return false
    }
    const keys = wanted.map(song => song.sourceUrl ?? '')
    setGetting(before => new Set([...before, ...keys]))
    try {
      await apiFor(server.connection).importEnqueue({
        items: wanted.map(song => ({
          url: song.sourceUrl ?? '',
          title: song.title,
          artist: song.artist,
          album: song.album,
          thumbnail: null,
          duration: song.duration,
        })),
        tagIds: [],
        playlistId: null,
        createPlaylistName: null,
      })
      showToast(
        wanted.length === 1
          ? `Getting “${wanted[0]?.title ?? ''}”. It arrives in your library as it imports.`
          : `Getting ${plural(wanted.length, 'song', 'songs')}. They arrive in your library as they import.`,
        'good',
      )
      return true
    } catch (error) {
      setGetting(before => new Set([...before].filter(key => !keys.includes(key))))
      showToast(failureText('Couldn’t get that', error), 'error')
      return false
    }
  }

  return { reachable: server.state === 'reachable', getting, get }
}
