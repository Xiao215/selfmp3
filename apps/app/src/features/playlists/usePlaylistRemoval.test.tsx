import type { ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { configureClient, queryKeys, type Api } from '@selfmp3/client'
import type { PlaylistSongs } from '@selfmp3/shared'

import { currentToasts, dismissToast, sendPending } from '../../ui/toast'
import { beforeRefilling, usePlaylistRemoval } from './usePlaylistRemoval'

/*
 * Songs out of a playlist, and the playlist with its last one (bug bash
 * R2-m12): what reaches the library once the Undo's time is up, through a
 * real query client and a stub library that records what it was asked.
 */

const sent: string[] = []
configureClient({
  api: {
    removeManyFromPlaylist: (playlistId: number, songIds: readonly number[]) => {
      sent.push(`remove ${playlistId}: ${songIds.join(',')}`)
      return Promise.resolve({ playlist: null })
    },
    deletePlaylist: (id: number) => {
      sent.push(`delete ${id}`)
      return Promise.resolve()
    },
    library: () => new Promise(() => undefined),
    onCloudLibraryChanged: () => () => undefined,
    answersFromCloud: () => false,
  } as unknown as Api,
})

const PLAYLIST = { id: 7, name: 'Road trip' }
const song = (id: number) => ({ id, title: `Song ${id}` })

async function removal(songIds: readonly number[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData<PlaylistSongs>(queryKeys.playlistSongs(PLAYLIST.id), {
    playlistId: PLAYLIST.id,
    songIds: [...songIds],
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return (await renderHook(() => usePlaylistRemoval(), { wrapper })).result
}

/** Lets the sends and what follows them run. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 10; turn++) await Promise.resolve()
}

afterEach(() => {
  sent.length = 0
  for (const toast of currentToasts()) dismissToast(toast.id)
})

describe('taking songs out of a playlist', () => {
  it('deletes the playlist with its last song, once the songs are out', async () => {
    const remove = await removal([1])
    await act(() => remove.current(PLAYLIST, [song(1)]))
    expect(currentToasts().at(-1)).toMatchObject({
      over: 'Removed from Road trip',
      under: 'The playlist goes with its last song',
    })
    expect(sent).toEqual([])
    await act(async () => {
      sendPending()
      await settle()
    })
    expect(sent).toEqual(['remove 7: 1', 'delete 7'])
  })

  it('keeps a playlist that still has songs', async () => {
    const remove = await removal([1, 2])
    await act(() => remove.current(PLAYLIST, [song(1)]))
    expect(currentToasts().at(-1)?.under).toBeUndefined()
    await act(async () => {
      sendPending()
      await settle()
    })
    expect(sent).toEqual(['remove 7: 1'])
  })

  it('sends nothing at all when Undo is pressed: the playlist is as it was', async () => {
    const remove = await removal([1])
    await act(() => remove.current(PLAYLIST, [song(1)]))
    await act(() =>
      currentToasts()
        .at(-1)
        ?.actions.find(each => each.label === 'Undo')
        ?.onPress(),
    )
    await act(async () => {
      sendPending()
      await settle()
    })
    expect(sent).toEqual([])
  })

  it('keeps an emptied playlist that songs are added back to within the time', async () => {
    const remove = await removal([1])
    await act(() => remove.current(PLAYLIST, [song(1)]))
    await act(async () => {
      await beforeRefilling(PLAYLIST.id)
      await settle()
    })
    expect(sent).toEqual(['remove 7: 1'])
  })
})
