import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { QueueViaBucket } from './QueueViaBucket'

const mockRequest = jest.fn()

// The tag picker's "Create…" can offer an artist's page instead (`P11`), so it
// holds a router; nothing here navigates, and the real one needs an app round it.
jest.mock('expo-router', () => ({ useRouter: () => ({ navigate: () => undefined }) }))

jest.mock('@selfmp3/client', () => ({
  ...jest.requireActual('@selfmp3/client'),
  useLibrary: () => ({
    data: {
      tags: [{ id: 1, name: 'chill', colour: null }],
      playlists: [{ id: 7, name: 'Night drive', kind: 'manual' }],
    },
  }),
  useRequestCloudImport: () => ({
    mutate: mockRequest,
    isPending: false,
    isError: false,
    error: null,
  }),
}))

/*
 * The tag chooser opens a sheet, and a sheet reads
 * the insets a device would give it. Nothing here is about insets, so it is
 * handed a phone's frame and left alone.
 */
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
}

const draw = async (): Promise<void> => {
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueueViaBucket />
    </SafeAreaProvider>,
  )
}

/** Typing, flushed: a state update from an event needs its own act under React 19. */
const type = async (text: string): Promise<void> => {
  await act(async () => {
    await fireEvent.changeText(screen.getByTestId('queue-url'), text)
  })
}

const submit = async (): Promise<void> => {
  await act(async () => {
    await fireEvent.press(screen.getByTestId('queue-submit'))
  })
}

/**
 * Adding a link with no server in reach.
 *
 * The point of this form is that it is never a dead end, so what is worth
 * pinning down is that it asks for nothing but the link, and that what it sends
 * carries the tags the import screen would have, and never a playlist.
 */
describe('QueueViaBucket', () => {
  beforeEach(() => {
    mockRequest.mockClear()
    mockRequest.mockReset()
  })

  it('will not send an empty link', async () => {
    await draw()
    await submit()
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('sends the link, trimmed, with no tag chosen and never a playlist', async () => {
    await draw()
    // The library has a playlist, and still none is offered.
    expect(screen.queryByLabelText('Add to playlist')).toBeNull()
    await type('  https://youtu.be/ZRtdQ81jPUQ  ')
    await submit()

    expect(mockRequest).toHaveBeenCalledTimes(1)
    expect(mockRequest.mock.calls[0][0]).toEqual({
      url: 'https://youtu.be/ZRtdQ81jPUQ',
      tagIds: [],
      playlistId: null,
    })
  })

  it('says the server will take it, and empties the box so it cannot be sent twice', async () => {
    mockRequest.mockImplementation((_input, options) => options?.onSuccess?.())
    await draw()
    await type('https://youtu.be/ZRtdQ81jPUQ')
    await submit()

    expect(screen.getByTestId('queue-added')).toBeTruthy()
    expect(screen.getByTestId('queue-url').props['value']).toBe('')

    await submit()
    expect(mockRequest).toHaveBeenCalledTimes(1)
  })
})
