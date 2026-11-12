import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { WelcomeScreen } from './WelcomeScreen'

/**
 * Waiting on Google, Cancel ends the attempt: a look at the doorman still out
 * when it is pressed, which comes back signed in, signs nobody in.
 */

const mockAdopt = jest.fn()
let mockClaimed: (outcome: unknown) => void = () => undefined
const mockClaim = jest.fn(
  () =>
    new Promise(resolve => {
      mockClaimed = resolve
    }),
)
jest.mock('../../replica', () => ({
  library: {},
  session: {
    beginSignIn: () => Promise.resolve(),
    pendingSignIn: () => Promise.resolve({ attempt: 'a1' }),
    claimSignIn: () => mockClaim(),
    endedSession: () => Promise.resolve(null),
    clearEnded: () => Promise.resolve(),
  },
}))
jest.mock('../../connection/ConnectionProvider', () => ({
  useConnection: () => ({ signedInToCloud: mockAdopt, sessionEnded: null }),
}))
jest.mock('../settings/useSignOut', () => ({ useForgetEndedAccount: () => jest.fn() }))
jest.mock('../../offline/covers', () => ({ keptCovers: () => Promise.resolve([]) }))
jest.mock('../../ports/signInReturn', () => ({ onSignInBack: () => () => undefined }))
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

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
}

it('signs nobody in from a look that answers after Cancel', async () => {
  jest.useFakeTimers()
  try {
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <WelcomeScreen />
      </SafeAreaProvider>,
    )
    await fireEvent.press(screen.getByTestId('welcome-google'))
    // The first look goes out and waits on the doorman's claim.
    await act(async () => {
      jest.advanceTimersByTime(0)
    })
    expect(mockClaim).toHaveBeenCalled()

    await fireEvent.press(screen.getByText('Cancel'))
    await act(async () => {
      mockClaimed({ status: 'signed-in', session: { me: { account: 'x' } } })
    })

    expect(mockAdopt).not.toHaveBeenCalled()
    expect(screen.getByTestId('welcome-google')).toBeTruthy()
  } finally {
    jest.useRealTimers()
  }
})
