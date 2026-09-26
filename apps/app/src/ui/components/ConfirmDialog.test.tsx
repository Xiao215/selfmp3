import { render, screen, waitFor } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { OverlayProvider } from '../../shell/Overlay'
import { ConfirmDialog } from './ConfirmDialog'

/**
 * The dialog that asks before something irreversible used to be cut onto the
 * page and cut off it again. It now arrives and leaves like a computer's sheet,
 * and what that costs in behaviour — the one thing a test can see — is that it is
 * still drawn for as long as its exit takes after it has been closed.
 */

jest.mock('../../shell/useLayout', () => ({
  useLayout: () => ({ wide: false, dense: false, compact: true, finePointer: false, width: 390 }),
}))

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
}

const tree = (open: boolean) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <OverlayProvider>
      <ConfirmDialog
        open={open}
        title="Forget this device?"
        confirmLabel="Forget"
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />
    </OverlayProvider>
  </SafeAreaProvider>
)

const draw = (open: boolean) => render(tree(open))

describe('ConfirmDialog', () => {
  it('is not on the page until it is asked for', async () => {
    await draw(false)
    expect(screen.queryByTestId('confirm-dialog')).toBeNull()
  })

  it('stays drawn while its exit plays, and then goes', async () => {
    const view = await draw(true)
    expect(screen.getByTestId('confirm-dialog')).toBeTruthy()

    await view.rerender(tree(false))
    // Still there: closing it starts the fade rather than taking it away.
    expect(screen.queryByTestId('confirm-dialog')).toBeTruthy()
    // And gone once the fade has landed.
    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).toBeNull())
  })
})
