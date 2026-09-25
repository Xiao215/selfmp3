/**
 * @jest-environment jsdom
 */
// jsdom rather than the React Native environment: the hook listens on
// `window`, which the native environment stands in for with Node's global,
// where there is no `addEventListener` and no Escape to press.
import { renderHook } from '@testing-library/react-native'

import { useEscape } from './useEscape.web'

function pressEscape(): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
}

/**
 * The web's Escape, whose one job is to close the topmost thing and nothing
 * beneath it.
 */
describe('useEscape', () => {
  it('closes the top layer, not one beneath it that has since re-rendered', async () => {
    // A sheet, then a popover over it. Both pass an inline `onClose`, so a
    // re-render of the sheet's parent hands the hook a new callback. That must
    // not move the sheet to the top of the stack.
    const closeSheet = jest.fn()
    const closePopover = jest.fn()
    const sheet = await renderHook(
      ({ onClose }: { onClose: () => void }) => useEscape(true, onClose, { layer: true }),
      { initialProps: { onClose: () => closeSheet('first') } },
    )
    const popover = await renderHook(() => useEscape(true, closePopover, { layer: true }))

    await sheet.rerender({ onClose: () => closeSheet('second') })
    pressEscape()

    expect(closePopover).toHaveBeenCalledTimes(1)
    expect(closeSheet).not.toHaveBeenCalled()

    await popover.unmount()
    await sheet.unmount()
  })

  it('leaves an Escape that an input method is using to drop a composition', async () => {
    const closeLayer = jest.fn()
    const closeBelow = jest.fn()
    const layer = await renderHook(() => useEscape(true, closeLayer, { layer: true }))
    const below = await renderHook(() => useEscape(true, closeBelow))

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, isComposing: true }),
    )
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, keyCode: 229 }),
    )
    expect(closeLayer).not.toHaveBeenCalled()
    expect(closeBelow).not.toHaveBeenCalled()

    pressEscape()
    expect(closeLayer).toHaveBeenCalledTimes(1)

    await below.unmount()
    await layer.unmount()
  })

  it('calls the latest callback, not the one it was first given', async () => {
    // The ref that keeps a layer in place must not leave it answering with a
    // stale closure.
    const onEscape = jest.fn()
    const hook = await renderHook(
      ({ onClose }: { onClose: () => void }) => useEscape(true, onClose, { layer: true }),
      { initialProps: { onClose: () => onEscape('first') } },
    )
    await hook.rerender({ onClose: () => onEscape('second') })
    pressEscape()

    expect(onEscape).toHaveBeenCalledTimes(1)
    expect(onEscape).toHaveBeenCalledWith('second')
    await hook.unmount()
  })

  it('leaves the stack when it closes, so the layer beneath takes the next press', async () => {
    const closeSheet = jest.fn()
    const closePopover = jest.fn()
    const sheet = await renderHook(() => useEscape(true, closeSheet, { layer: true }))
    const popover = await renderHook(() => useEscape(true, closePopover, { layer: true }))

    await popover.unmount()
    pressEscape()

    expect(closePopover).not.toHaveBeenCalled()
    expect(closeSheet).toHaveBeenCalledTimes(1)
    await sheet.unmount()
  })

  it('yields to an open layer when it is not one itself', async () => {
    // The library's selection listens after the layers have had their say.
    const clearSelection = jest.fn()
    const closeSheet = jest.fn()
    const selection = await renderHook(() => useEscape(true, clearSelection))
    const sheet = await renderHook(() => useEscape(true, closeSheet, { layer: true }))

    pressEscape()
    expect(closeSheet).toHaveBeenCalledTimes(1)
    expect(clearSelection).not.toHaveBeenCalled()

    await sheet.unmount()
    pressEscape()
    expect(clearSelection).toHaveBeenCalledTimes(1)
    await selection.unmount()
  })
})
