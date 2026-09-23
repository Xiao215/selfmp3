import { fireEvent, render, screen } from '@testing-library/react-native'

import { ServerAway } from './ServerAway'

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
  beforeEach(() => lookAgain.mockClear())

  it('says it is looking, with nothing to press', async () => {
    await render(
      <ServerAway reach={{ state: 'looking', lookAgain }} need="stats" testID="stats-server" />,
    )
    expect(screen.getByTestId('stats-server-looking')).toBeTruthy()
    expect(screen.getByText('Looking for your server…')).toBeTruthy()
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
    expect(screen.getByText('Your server isn’t answering')).toBeTruthy()

    await rerender(
      <ServerAway
        reach={{ state: 'away', said: false, lookAgain }}
        need="stats"
        testID="stats-server"
      />,
    )
    expect(screen.getByText('Your server hasn’t said where it is')).toBeTruthy()
  })

  it('names what this screen came for, and looks again when asked', async () => {
    await render(
      <ServerAway
        reach={{ state: 'away', said: true, lookAgain }}
        need="metadata"
        testID="metadata-server"
      />,
    )
    expect(screen.getByText(/Looking a song up goes through your server/)).toBeTruthy()

    await fireEvent.press(screen.getByTestId('metadata-server-look-again'))
    expect(lookAgain).toHaveBeenCalledTimes(1)
  })
})
