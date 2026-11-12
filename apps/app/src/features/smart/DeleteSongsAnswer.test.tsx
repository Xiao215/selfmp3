import { act, fireEvent, screen } from '@testing-library/react-native'
import type { AskCard } from '@selfmp3/shared'

import { currentToasts, dismissToast } from '../../ui/toast'
import { DeleteSongsAnswer } from './DeleteSongsAnswer'
import { drawReview, fakeLibrary, songOf } from './smartUndo.fixture'

/**
 * Ask's "delete these songs" (docs/features/ai.md, "Deleting songs"): the
 * card says which playlists go with the songs, for the songs still ticked,
 * and Delete asks the library's own question before anything is sent. Only
 * the network is faked.
 */

jest.mock('../../shell/useLayout', () => {
  const layout = { wide: false, dense: false, compact: true, finePointer: false, width: 390 }
  return {
    useLayout: () => layout,
    useLayoutFlags: () => layout,
    useLayoutValue: (select: (value: typeof layout) => unknown) => select(layout),
    useWindowValue: (select: (value: object) => unknown) =>
      select({ width: 390, height: 844, scale: 3, fontScale: 1 }),
  }
})

jest.mock('../../connection/ConnectionProvider', () => ({
  useConnection: () => ({ connection: null, fromCloud: false, status: 'ready' }),
}))

jest.mock('./useSmartServer', () => ({
  useSmartServer: () => ({
    api: jest.requireActual<typeof import('@selfmp3/client')>('@selfmp3/client').clientApi(),
    onDevice: (id: number) => id,
    onServer: (id: number) => id,
  }),
}))

const mockForgetSongs = jest.fn()
jest.mock('../../player/PlayerProvider', () => ({
  usePlayerCommands: () => ({ forgetSongs: mockForgetSongs }),
}))
jest.mock('../../offline/DownloadsProvider', () => ({
  useDownloads: () => ({ dropDownloads: () => Promise.resolve() }),
}))

const ANSWER: Extract<AskCard, { kind: 'deleteSongs' }> = {
  kind: 'deleteSongs',
  songs: [
    { songId: 1, why: null },
    { songId: 2, why: null },
  ],
  playlists: [
    { name: 'DOME LIVE', live: false, songIds: [1, 2], total: 2 },
    { name: 'Favourites', live: false, songIds: [2], total: 40 },
  ],
}

afterEach(() => {
  for (const toast of currentToasts()) dismissToast(toast.id)
})

it('says the playlist they empty goes too, asks once more, then deletes the ticked songs', async () => {
  const net = fakeLibrary([
    songOf(1, '夜に駆ける (Live)'),
    songOf(2, 'アイドル (Live)'),
    songOf(3, '群青'),
  ])
  const onDone = jest.fn()
  await drawReview(<DeleteSongsAnswer answer={ANSWER} height={600} onDone={onDone} />)

  expect(
    await screen.findByText(
      '“DOME LIVE” goes too: nothing would be left in it. Also takes 1 song out of “Favourites”.',
    ),
  ).toBeTruthy()
  // Leaving one out keeps the playlist: it says so at once.
  await act(async () => {
    await fireEvent.press(screen.getAllByTestId('delete-songs-song')[0]!)
  })
  expect(
    screen.getByText('Also takes songs out of “DOME LIVE” (1), “Favourites” (1).'),
  ).toBeTruthy()
  expect(screen.getByText('Delete 1 song')).toBeTruthy()
  await act(async () => {
    await fireEvent.press(screen.getAllByTestId('delete-songs-song')[0]!)
  })

  await act(async () => {
    await fireEvent.press(screen.getByTestId('delete-songs-apply'))
  })
  // Nothing is sent before the library's own question is answered.
  expect(net.sent).toEqual([])
  expect(screen.getByTestId('confirm-remove-songs')).toBeTruthy()

  await act(async () => {
    await fireEvent.press(screen.getByText('Delete'))
  })
  expect(net.sent).toEqual([{ at: 'POST /api/songs/bulk/delete', body: { songIds: [1, 2] } }])
  expect(net.songs.map(song => song.id)).toEqual([3])
  expect(mockForgetSongs).toHaveBeenCalledWith([1, 2])
  expect(onDone).toHaveBeenCalledWith('Deleted 2 songs')
})
