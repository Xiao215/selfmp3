import { render, screen } from '@testing-library/react-native'

import { StatsViaServer } from './StatsViaServer'

// expo-router ships its navigation package untranspiled, which jest cannot
// read. The page only reaches it for the phone's "‹ You" row.
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: () => undefined, replace: () => undefined, canGoBack: () => false }),
  useNavigation: () => ({ getState: () => undefined }),
}))
jest.mock('../../connection/ConnectionProvider', () => ({
  useConnection: () => ({ fromCloud: true }),
}))
jest.mock('../../connection/useServerDirect', () => ({
  useServerDirect: () => ({ state: 'away', said: true, lookAgain: () => undefined }),
}))

/**
 * The page a cloud library gets when its server is not answering.
 *
 * This is the behaviour the whole change is about: Stats used to be left out
 * of the sidebar entirely, which from where the user sits is the same as
 * self.mp3 having no stats. The page is drawn — heading, tabs, window — and
 * the reason sits in its body.
 */
describe('Stats from a cloud library with no server in reach', () => {
  it('draws the page and says why it is empty', async () => {
    await render(<StatsViaServer initialTab="overview" />)

    expect(screen.getByTestId('stats-screen')).toBeTruthy()
    expect(screen.getByText('Stats')).toBeTruthy()
    expect(screen.getByTestId('stats-server-away')).toBeTruthy()
    expect(screen.getByText('Your server isn’t answering')).toBeTruthy()
    expect(screen.getByText(/Stats come from your server/)).toBeTruthy()
  })
})
