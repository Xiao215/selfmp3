import { act, fireEvent, screen } from '@testing-library/react-native'
import { queryKeys } from '@selfmp3/client'
import type { CopiesResult, Library } from '@selfmp3/shared'

import { currentToasts, dismissToast, sendPending } from '../../ui/toast'
import { CopiesReview } from './CopiesReview'
import { drawReview, fakeLibrary, pressToast, songOf } from './smartUndo.fixture'

/**
 * Deleting an extra copy folds it into the one kept, which cannot be taken
 * back once made; so Delete waits out its Undo before it is sent, as an email
 * client's undo-send (docs/features/ai.md, "Copies"). Only the network is
 * faked: the library's computer answering the app's real API client.
 */

jest.mock('../../shell/useLayout', () => {
  const layout = { wide: false, dense: false, compact: true, finePointer: false, width: 390 }
  return {
    useLayout: () => layout,
    useLayoutValue: (select: (value: typeof layout) => unknown) => select(layout),
    useWindowValue: (select: (value: object) => unknown) =>
      select({ width: 390, height: 844, scale: 3, fontScale: 1 }),
  }
})

// A device talking to its library's computer, not a cloud library.
jest.mock('../../connection/ConnectionProvider', () => ({
  useConnection: () => ({ connection: null, fromCloud: false, status: 'ready' }),
}))

// The library's computer is this device's server: its ids are this device's.
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
const mockDropDownloads = jest.fn(() => Promise.resolve())
jest.mock('../../offline/DownloadsProvider', () => ({
  useDownloads: () => ({ dropDownloads: mockDropDownloads }),
}))

const RESULT: CopiesResult = {
  copies: [{ key: 'c1', keep: 1, songIds: [2], why: 'Exact copies', by: 'rule' }],
  looked: 2,
  note: null,
}

const DELETED = 'Deleted the extra copy'

/** The library as this device holds it now, by song id. */
const held = (client: Awaited<ReturnType<typeof drawReview>>): number[] =>
  client.getQueryData<Library>(queryKeys.library)?.songs.map(song => song.id) ?? []

/** Draws the review, ticks nothing more, and presses Delete and the dialog's Delete. */
async function deleteTheCopy() {
  const net = fakeLibrary([
    songOf(1, '夜に駆ける', { album: 'THE BOOK', playCount: 12 }),
    songOf(2, '夜に駆ける'),
  ])
  const onClose = jest.fn()
  const client = await drawReview(<CopiesReview result={RESULT} height={600} onClose={onClose} />)
  await act(async () => {
    await fireEvent.press(await screen.findByTestId('copies-apply'))
  })
  await act(async () => {
    await fireEvent.press(screen.getByTestId('fold-copies-confirm'))
  })
  return { net, client, onClose }
}

beforeEach(() => {
  jest.useFakeTimers()
  mockForgetSongs.mockClear()
  mockDropDownloads.mockClear()
})

afterEach(() => {
  sendPending()
  for (const toast of currentToasts()) dismissToast(toast.id)
  jest.useRealTimers()
})

describe('Deleting an extra copy', () => {
  it('hides it at once and says so, and sends the fold only once the Undo has gone', async () => {
    const { net, client, onClose } = await deleteTheCopy()

    expect(onClose).toHaveBeenCalled()
    expect(held(client)).toEqual([1])
    expect(currentToasts().at(-1)?.say).toBe(DELETED)
    expect(
      currentToasts()
        .at(-1)
        ?.actions.map(action => action.label),
    ).toEqual(['Undo'])
    // Nothing written yet: the copy is still in the library's computer.
    expect(net.sent).toEqual([])
    expect(mockForgetSongs).not.toHaveBeenCalled()

    await act(async () => {
      await jest.advanceTimersByTimeAsync(5000)
    })

    expect(net.sent).toEqual([{ at: 'POST /api/songs/merge', body: { keep: 1, songIds: [2] } }])
    expect(net.songs.map(song => song.id)).toEqual([1])
    expect(mockForgetSongs).toHaveBeenCalledWith([2])
    expect(mockDropDownloads).toHaveBeenCalledWith([2])
    expect(currentToasts().map(toast => toast.say)).not.toContain(DELETED)
  })

  it('is cancelled by Undo before anything was written, and the copy comes back', async () => {
    const { net, client } = await deleteTheCopy()

    await act(async () => {
      pressToast('Undo')
      await jest.advanceTimersByTimeAsync(10_000)
      sendPending()
      await jest.advanceTimersByTimeAsync(0)
    })

    expect(net.sent).toEqual([])
    expect(net.songs.map(song => song.id)).toEqual([1, 2])
    expect(held(client)).toEqual([1, 2])
    expect(mockForgetSongs).not.toHaveBeenCalled()
  })

  it('is sent at once when the app leaves, so closing it loses nothing', async () => {
    const { net } = await deleteTheCopy()

    await act(async () => {
      sendPending()
      await jest.advanceTimersByTimeAsync(0)
    })

    expect(net.sent).toEqual([{ at: 'POST /api/songs/merge', body: { keep: 1, songIds: [2] } }])
    expect(currentToasts().map(toast => toast.say)).not.toContain(DELETED)
  })
})
