import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { AccessibilityInfo, Appearance, Dimensions } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useUnistyles } from 'react-native-unistyles'

import { OverlayProvider } from '../../shell/Overlay'
import { AccentProvider, useAccent } from '../../ui/accent'
import { AppearancePanel } from './AppearancePanel'

jest.mock('../../shell/useLayout', () => ({
  useLayout: () => ({ wide: false, compact: true, dense: false, finePointer: false, width: 390 }),
}))

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

async function openAndChoose(option: string): Promise<void> {
  await act(async () => {
    await fireEvent.press(screen.getByRole('combobox', { name: 'Theme' }))
  })
  await settle(400)
  await act(async () => {
    await fireEvent.press(screen.getByRole('option', { name: option }))
  })
  await settle(600)
}

/**
 * The theme dropdown in Settings, opened and closed over and over: what it
 * leaves behind. The phone felt slow after this, so the suspects are counted —
 * mounted views, pending timers, listeners on Appearance, Dimensions and
 * AccessibilityInfo, and renders of whatever reads the accent or the theme.
 */
describe('the theme dropdown, opened and closed', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it('accumulates nothing across ten open/close cycles', async () => {
    const appearance = jest.spyOn(Appearance, 'addChangeListener')
    const dimensions = jest.spyOn(Dimensions, 'addEventListener')
    const a11y = jest.spyOn(AccessibilityInfo, 'addEventListener')
    const { container } = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <AccentProvider>
          <OverlayProvider>
            <AppearancePanel anchor={() => undefined} />
            <AccentReader />
            <ThemeReader />
          </OverlayProvider>
        </AccentProvider>
      </SafeAreaProvider>,
    )
    await settle(500)
    const mounted = (): number => container.queryAll(() => true).length
    const nodesBefore = mounted()
    const listenersBefore =
      appearance.mock.calls.length + dimensions.mock.calls.length + a11y.mock.calls.length
    accentReads = 0
    themeReads = 0

    // Closed by choosing what is already chosen, so the theme never changes.
    await openAndChoose('Dark')
    // After one cycle the exit animation's handles are what jest counts as
    // timers; the question is whether nine more cycles add to them.
    const timersAfterOne = jest.getTimerCount()
    for (let cycle = 1; cycle < 10; cycle++) await openAndChoose('Dark')

    expect(mounted()).toBe(nodesBefore)
    expect(jest.getTimerCount()).toBe(timersAfterOne)
    expect(
      appearance.mock.calls.length + dimensions.mock.calls.length + a11y.mock.calls.length,
    ).toBe(listenersBefore)
    // Nothing that reads the accent or the theme renders for a dropdown.
    expect(accentReads).toBe(0)
    expect(themeReads).toBe(0)
  })

  it('changing the theme renders what reads the accent once, and the stylesheets nothing', async () => {
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <AccentProvider>
          <OverlayProvider>
            <AppearancePanel anchor={() => undefined} />
            <AccentReader />
            <ThemeReader />
          </OverlayProvider>
        </AccentProvider>
      </SafeAreaProvider>,
    )
    await settle(500)
    accentReads = 0
    themeReads = 0
    await openAndChoose('Light')
    expect(accentReads).toBe(1)
    // Unistyles' mock does not restyle in a test; on a device `useUnistyles`
    // readers render once for a theme change, and stylesheets re-render nothing.
    expect(themeReads).toBeLessThanOrEqual(1)
  })
})
