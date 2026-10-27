import type { ReactNode } from 'react'
import { Pressable, Text } from 'react-native'
import { fireEvent, render, screen } from '@testing-library/react-native'

import { OverlayProvider, useOverlay } from './Overlay'

function Layer({ open, onPress }: { open?: boolean; onPress: () => void }): ReactNode {
  useOverlay(
    <Pressable testID="layer-row" onPress={onPress}>
      <Text>Slow Train North</Text>
    </Pressable>,
    true,
    open,
  )
  return null
}

/**
 * The overlay host, where sheets, popovers and dialogs are drawn: a layer on
 * its way out is still drawn but no longer takes a touch (R2-m16).
 */
describe('OverlayProvider', () => {
  it('lets an open layer take a press', async () => {
    const onPress = jest.fn()
    await render(
      <OverlayProvider>
        <Layer open onPress={onPress} />
      </OverlayProvider>,
    )
    await fireEvent.press(screen.getByTestId('layer-row'))
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('takes no press on a layer that is closing but still drawn', async () => {
    const onPress = jest.fn()
    const view = await render(
      <OverlayProvider>
        <Layer open onPress={onPress} />
      </OverlayProvider>,
    )
    await view.rerender(
      <OverlayProvider>
        <Layer open={false} onPress={onPress} />
      </OverlayProvider>,
    )
    // Still there, sinking or fading: only its touches are gone.
    await fireEvent.press(screen.getByTestId('layer-row'))
    expect(onPress).not.toHaveBeenCalled()
  })

  it('leaves what is not a layer pressable', async () => {
    const onPress = jest.fn()
    await render(
      <OverlayProvider>
        <Layer onPress={onPress} />
      </OverlayProvider>,
    )
    await fireEvent.press(screen.getByTestId('layer-row'))
    expect(onPress).toHaveBeenCalledTimes(1)
  })
})
