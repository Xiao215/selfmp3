import type { ReactElement } from 'react'
import { render, screen } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { OverlayProvider } from '../../shell/Overlay'
import { Confirmations } from './Confirmations'
import type { Confirming } from './settings.model'

/**
 * Settings' questions before something that cannot be taken back: once
 * answered, the dialog fades out still saying what it asked.
 */

jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn() }) }))
jest.mock('../../offline/DownloadsProvider', () => ({
  useDownloads: () => ({ removeAll: jest.fn() }),
}))
jest.mock('../../connection/ConnectionProvider', () => ({
  useConnection: () => ({ storageForgotten: jest.fn() }),
}))
jest.mock('../../replica', () => ({ session: {} }))
jest.mock('../../ports/place', () => ({ thisPlace: () => 'phone' }))
jest.mock('./SignOutDialog', () => ({ SignOutDialog: () => null }))
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

const tree = (confirming: Confirming): ReactElement => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <OverlayProvider>
      <Confirmations confirming={confirming} onDone={() => undefined} />
    </OverlayProvider>
  </SafeAreaProvider>
)

it('keeps its words while it fades out', async () => {
  // The fade's clock is the test's, so a loaded machine cannot run it out
  // before the second look.
  jest.useFakeTimers()
  try {
    const view = await render(tree('remove-downloads'))
    expect(screen.getByText('Remove all songs from this phone?')).toBeTruthy()

    await view.rerender(tree(null))
    expect(screen.getByText('Remove all songs from this phone?')).toBeTruthy()
    expect(screen.getByText('Remove all from this phone')).toBeTruthy()
  } finally {
    jest.useRealTimers()
  }
})
