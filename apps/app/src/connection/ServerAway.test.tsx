import { fireEvent, render, screen } from '@testing-library/react-native'

import { ServerAway } from './ServerAway'

const mockShared = { url: '' }
jest.mock('../ports/sharedServerUrl', () => ({
  get sharedServerUrl() {
    return mockShared.url
  },
}))

const mockJoin = { mutate: jest.fn(), isPending: false, error: null as Error | null }
jest.mock('@selfmp3/client', () => ({
  ...jest.requireActual('@selfmp3/client'),
  useJoinSharedServer: () => mockJoin,
}))

/**
 * The card that replaced not drawing the screen at all.
 *
 * The whole point of it is that it says something, and says which thing: a
 * server that is off reads differently from one that has never announced an
 * address, and each screen names what it came for. So that is what is held
 * down here — a card that quietly said nothing would be the old bug again.
 */
describe('ServerAway', () => {
  const lookAgain = jest.fn()
  beforeEach(() => {
    lookAgain.mockClear()
    mockJoin.mutate.mockClear()
    mockJoin.error = null
    mockShared.url = ''
  })

  it('says it is looking, with nothing to press', async () => {
    await render(
      <ServerAway reach={{ state: 'looking', lookAgain }} need="stats" testID="stats-server" />,
    )
    expect(screen.getByTestId('stats-server-looking')).toBeTruthy()
    expect(screen.getByText('Looking for your library’s computer…')).toBeTruthy()
    expect(screen.queryByTestId('stats-server-look-again')).toBeNull()
  })

  it('tells a server that is off apart from one that never said where it is', async () => {
    const { rerender } = await render(
      <ServerAway
        reach={{ state: 'away', said: true, lookAgain }}
        need="stats"
        testID="stats-server"
      />,
    )
    expect(screen.getByText('Your library’s computer isn’t answering')).toBeTruthy()

    await rerender(
      <ServerAway
        reach={{ state: 'away', said: false, lookAgain }}
        need="stats"
        testID="stats-server"
      />,
    )
    expect(screen.getByText('Your library’s computer hasn’t said where it is')).toBeTruthy()
  })

  it('names what this screen came for, and looks again when asked', async () => {
    await render(
      <ServerAway
        reach={{ state: 'away', said: true, lookAgain }}
        need="metadata"
        testID="metadata-server"
      />,
    )
    // Under the title, what still works; what this screen needed waits behind Why?.
    expect(screen.getByText('Your songs still play.')).toBeTruthy()
    expect(screen.queryByText(/Looking a song up goes through/)).toBeNull()
    await fireEvent.press(screen.getByTestId('metadata-server-why'))
    expect(screen.getByText(/Looking a song up goes through your library’s computer/)).toBeTruthy()

    await fireEvent.press(screen.getByTestId('metadata-server-look-again'))
    expect(lookAgain).toHaveBeenCalledTimes(1)
  })

  it('offers the shared computer to a library that never had one, and joins it', async () => {
    mockShared.url = 'https://pi.example.ts.net'
    await render(
      <ServerAway
        reach={{ state: 'away', said: false, lookAgain }}
        need="import"
        testID="import-server"
      />,
    )
    expect(screen.getByText('No computer works for your library yet')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('import-server-join'))
    expect(mockJoin.mutate).toHaveBeenCalledTimes(1)
    // Joined, the screen looks again and finds it.
    const [, options] = mockJoin.mutate.mock.calls[0] as [unknown, { onSuccess: () => void }]
    options.onSuccess()
    expect(lookAgain).toHaveBeenCalledTimes(1)
  })

  it('offers nothing to a library whose own computer is only off', async () => {
    mockShared.url = 'https://pi.example.ts.net'
    await render(
      <ServerAway
        reach={{ state: 'away', said: true, lookAgain }}
        need="stats"
        testID="stats-server"
      />,
    )
    expect(screen.queryByTestId('stats-server-join')).toBeNull()
  })
})
