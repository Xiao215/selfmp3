import { useCallback } from 'react'
import { isDownloaded, useLibrary } from '@selfmp3/client'
import { useDownloads } from '../offline/DownloadsProvider'
import { rowAvailability, type RowAvailability } from './rowAvailability.model'

/**
 * `rowAvailability` for the device as it is now: what every list hands its
 * rows about whether a song can play here. Made again only when the downloads,
 * the connection or the library's answer change, so a row's memo holds.
 */
export function useRowAvailability(): (songId: number) => RowAvailability {
  const { state: downloads, installed, streamBlocked } = useDownloads()
  const { isError } = useLibrary()
  return useCallback(
    songId =>
      rowAvailability(isDownloaded(downloads.index, songId), {
        installed,
        streamBlocked,
        libraryUnreachable: isError,
      }),
    [downloads.index, installed, streamBlocked, isError],
  )
}
