import { Text } from 'react-native'
import { act, fireEvent, render, screen } from '@testing-library/react-native'

import { OverlayProvider } from '../../shell/Overlay'
import type { PopoverAnchor } from '../rightClick'
import { Popover } from './Popover'

jest.mock('../../shell/useLayout', () => {
  const layout = { wide: true, dense: false, compact: false, finePointer: false, width: 1210 }
  return {
    useLayout: () => layout,
    useLayoutFlags: () => layout,
    useLayoutValue: (select: (value: typeof layout) => unknown) => select(layout),
    useWindowValue: (select: (value: object) => unknown) =>
      select({ width: 1210, height: 834, scale: 2, fontScale: 1 }),
  }
})

// A row's ⋯ on a landscape iPad, a third of the way down the window.
const anchorRef: { current: PopoverAnchor | null } = {
  current: { measureInWindow: callback => callback(1150, 288, 32, 32) },
}

async function openMenu(onClose: () => void): Promise<void> {
  await render(
    <OverlayProvider>
      <Popover open onClose={onClose} anchorRef={anchorRef} label="Morning Static" testID="menu">
        <Text>Play next</Text>
      </Popover>
    </OverlayProvider>,
  )
}

/**
 * A popover beside its control. Its click-catchers cover the window round the
 * control, so they come only with a panel that can be seen: an iPad once
 * opened a ⋯ menu that never drew while its catchers took the next tap
 * (R2-m18).
 */
describe('Popover beside its control', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('puts up no catchers until its panel has measured itself', async () => {
    await openMenu(jest.fn())
    expect(screen.getByTestId('menu')).toBeTruthy()
    // The panel is modal to VoiceOver, which hides the views beside it from queries.
    expect(screen.queryByLabelText('Close', { includeHiddenElements: true })).toBeNull()

    await act(() =>
      fireEvent(screen.getByTestId('menu'), 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width: 240, height: 180 } },
      }),
    )
    expect(screen.getByLabelText('Close', { includeHiddenElements: true })).toBeTruthy()
  })

  it('closes an opening whose panel never measures', async () => {
    const onClose = jest.fn()
    await openMenu(onClose)
    await act(() => jest.advanceTimersByTime(2000))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('stays open once its panel has measured', async () => {
    const onClose = jest.fn()
    await openMenu(onClose)
    await act(() =>
      fireEvent(screen.getByTestId('menu'), 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width: 240, height: 180 } },
      }),
    )
    await act(() => jest.advanceTimersByTime(2000))
    expect(onClose).not.toHaveBeenCalled()
  })
})
