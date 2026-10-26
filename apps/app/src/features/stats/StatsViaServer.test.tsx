import { fireEvent, render, screen } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { StatsViaServer } from './StatsViaServer'

// expo-router ships its navigation package untranspiled, which jest cannot
// read. The page only reaches it for the phone’s ‹ and the Report link.
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: () => undefined, replace: () => undefined, canGoBack: () => false }),
  useNavigation: () => ({ getState: () => undefined }),
  usePathname: () => '/',
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
 * self.mp3 having no stats. The page is drawn — heading, window — and
 * the reason sits in its body.
 */
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
}

describe('Stats from a cloud library with no server in reach', () => {
  it('draws the page and says why it is empty', async () => {
    // A phone's window control holds a sheet, which reads the insets a device would give it.
    await render(
      <QueryClientProvider client={new QueryClient()}>
        <SafeAreaProvider initialMetrics={METRICS}>
          <StatsViaServer />
        </SafeAreaProvider>
      </QueryClientProvider>,
    )

    expect(screen.getByTestId('stats-screen')).toBeTruthy()
    expect(screen.getByText('Stats')).toBeTruthy()
    expect(screen.getByTestId('stats-server-away')).toBeTruthy()
    expect(screen.getByText('Your library’s computer isn’t answering')).toBeTruthy()
    // The Report is a page of its own, and still one step away.
    expect(screen.getByTestId('stats-report')).toBeTruthy()
    // Why the page is empty is one Why? away, under what still works.
    expect(screen.getByText('Your songs still play.')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('stats-server-why'))
    expect(screen.getByText(/Stats are worked out on your library’s computer/)).toBeTruthy()
  })
})
