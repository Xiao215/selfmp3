import { fireEvent, render, screen } from '@testing-library/react-native'
import type { RoomState } from '@selfmp3/shared'

import { RoomShelves } from './RoomPicks'

/**
 * Putting a playlist up as a room's shelf reads its songs first; a read that
 * fails says so, where it used to leave the press doing nothing at all.
 */

const mockToast = jest.fn()
const mockPlaylistSongs = jest.fn()
jest.mock('../../ui/toast', () => ({ showToast: (...args: unknown[]) => mockToast(...args) }))
jest.mock('../../replica', () => ({
  library: { cloudPlaylistSongs: (id: number) => mockPlaylistSongs(id) },
}))
jest.mock('./room.store', () => ({ roomAct: jest.fn() }))
jest.mock('./room.model', () => ({
  ...jest.requireActual('./room.model'),
  youMay: () => true,
}))
jest.mock('@selfmp3/client', () => ({
  ...jest.requireActual('@selfmp3/client'),
  useLibrary: () => ({
    data: { songs: [], tags: [], playlists: [{ id: 3, name: 'Night drive' }] },
  }),
}))

const state = { shelves: [], entries: [], you: 'me' } as unknown as RoomState

it('says so when a playlist’s songs cannot be read', async () => {
  mockPlaylistSongs.mockRejectedValue(new Error('no answer'))
  await render(<RoomShelves state={state} />)

  await fireEvent.press(screen.getByTestId('room-shelf'))
  await fireEvent.press(screen.getByText('Night drive'))

  expect(mockPlaylistSongs).toHaveBeenCalledWith(3)
  expect(mockToast).toHaveBeenCalledWith('Couldn’t read that playlist', 'error')
})
