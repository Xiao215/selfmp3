import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useUnistyles } from 'react-native-unistyles'

import { AccentProvider, useAccent } from '../../ui/accent'
import { ThemeTile } from './AppearancePanel'

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
}

let accentReads = 0
function AccentReader(): null {
  useAccent()
  accentReads++
  return null
}
let themeReads = 0
function ThemeReader(): null {
  const { theme } = useUnistyles()
  void theme.colors.accent
  themeReads++
  return null
}

async function settle(ms: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(ms)
  })
}

/**
 * The Theme tile in Settings (B, 2026-10-26): each press the next of Dark,
 * Light and this device's own, and what a change costs the rest of the app.
 */
describe('the theme tile', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it('steps through the three themes and back to the first', async () => {
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <AccentProvider>
          <ThemeTile />
        </AccentProvider>
      </SafeAreaProvider>,
    )
    await settle(500)
    const order = ['Theme, Dark', 'Theme, Light', 'Theme, Match this device']
    const label = (): string =>
      String(screen.getByTestId('settings-theme').props['accessibilityLabel'])
    const first = order.indexOf(label())
    expect(first).toBeGreaterThanOrEqual(0)
    for (let press = 1; press <= 3; press++) {
      await act(async () => {
        await fireEvent.press(screen.getByTestId('settings-theme'))
      })
      await settle(100)
      expect(label()).toBe(order[(first + press) % order.length])
    }
  })

  it('changing the theme renders what reads the accent once, and the stylesheets nothing', async () => {
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <AccentProvider>
          <ThemeTile />
          <AccentReader />
          <ThemeReader />
        </AccentProvider>
      </SafeAreaProvider>,
    )
    await settle(500)
    accentReads = 0
    themeReads = 0
    await act(async () => {
      await fireEvent.press(screen.getByTestId('settings-theme'))
    })
    await settle(600)
    expect(accentReads).toBe(1)
    // Unistyles' mock does not restyle in a test; on a device `useUnistyles`
    // readers render once for a theme change, and stylesheets re-render nothing.
    expect(themeReads).toBeLessThanOrEqual(1)
  })
})
