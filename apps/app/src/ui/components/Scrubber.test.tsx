import { fireEvent, render, screen } from '@testing-library/react-native'
import { StyleSheet } from 'react-native'

import { Scrubber } from './Scrubber'

/**
 * The one scrubber under the seek bar, a preview's bar and the volume fader
 * (T-381, T-418). What each copy had missed: the volume said no value in a
 * browser and let a wandering drag be taken from it; the preview's bar wrote
 * an unrounded share each tick and stepped from the player's place rather
 * than the one it showed.
 */

const touch = (x: number, y = 0) => ({
  nativeEvent: { locationX: x, locationY: y },
  touchHistory: { touchBank: [] },
})

const layout = (width: number, height: number) => ({
  nativeEvent: { layout: { width, height, x: 0, y: 0 } },
})

/** The style the fill is drawn with: the first view inside the track. */
const fillOf = (bar: ReturnType<typeof screen.getByTestId>) => {
  const track = bar.children[0] as typeof bar
  const fill = track.children[0] as typeof bar
  return StyleSheet.flatten(fill.props['style'])
}

describe('Scrubber', () => {
  it('says where it is to a browser, as a level said in per cent', async () => {
    await render(
      <Scrubber
        value={0.52}
        max={1}
        onCommit={() => undefined}
        label="Volume"
        step={0.05}
        spokenScale={100}
        testID="volume"
      />,
    )
    const bar = screen.getByTestId('volume')
    expect(bar.props['aria-valuenow']).toBe(52)
    expect(bar.props['aria-valuemax']).toBe(100)
    expect(bar.props['accessibilityValue']).toEqual({ min: 0, max: 100, now: 52 })
  })

  it('keeps a drag that wanders: it does not let the page or the list take it', async () => {
    await render(
      <Scrubber
        value={0}
        max={1}
        onCommit={() => undefined}
        label="Volume"
        step={0.05}
        testID="v"
      />,
    )
    const bar = screen.getByTestId('v')
    expect(bar.props['onResponderTerminationRequest']()).toBe(false)
  })

  it('follows the finger while it moves when asked to, and lands where it is let go', async () => {
    const onChange = jest.fn()
    const onCommit = jest.fn()
    await render(
      <Scrubber
        value={0.2}
        max={1}
        onChange={onChange}
        onCommit={onCommit}
        label="Volume"
        step={0.05}
        vertical
        testID="v"
      />,
    )
    const bar = screen.getByTestId('v')
    await fireEvent(bar, 'layout', layout(32, 100))
    await fireEvent(bar, 'responderGrant', touch(10, 75))
    expect(onChange).toHaveBeenLastCalledWith(0.25)
    await fireEvent(bar, 'responderMove', touch(10, 40))
    expect(onChange).toHaveBeenLastCalledWith(0.6)
    await fireEvent(bar, 'responderRelease', touch(10, 40))
    expect(onCommit).toHaveBeenCalledWith(0.6)
  })

  it('rounds the fill to a tenth of a per cent, so a tick reuses a rule', async () => {
    await render(
      <Scrubber
        value={12.3456}
        max={100}
        onCommit={() => undefined}
        label="Seek"
        step={10}
        testID="s"
      />,
    )
    expect(fillOf(screen.getByTestId('s'))).toMatchObject({ width: '12.3%' })
  })

  it('steps a screen reader from where it shows, not from where the player was', async () => {
    const onCommit = jest.fn()
    const view = await render(
      <Scrubber value={60} max={100} onCommit={onCommit} hold label="Seek" step={10} testID="s" />,
    )
    const bar = screen.getByTestId('s')
    await fireEvent(bar, 'layout', layout(200, 34))
    await fireEvent(bar, 'responderGrant', touch(40))
    await fireEvent(bar, 'responderRelease', touch(40))
    expect(onCommit).toHaveBeenLastCalledWith(20)

    // The player still says 60; the bar shows 20, and a step goes on from there.
    await view.rerender(
      <Scrubber value={60} max={100} onCommit={onCommit} hold label="Seek" step={10} testID="s" />,
    )
    await fireEvent(bar, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } })
    expect(onCommit).toHaveBeenLastCalledWith(30)
  })

  it('calls off a drag still held when the song changes, rather than seeking the next one', async () => {
    const onCommit = jest.fn()
    const bar = (of: number) => (
      <Scrubber
        value={10}
        max={100}
        onCommit={onCommit}
        hold
        label="Seek"
        step={10}
        testID="s"
        of={of}
      />
    )
    const view = await render(bar(1))
    const track = screen.getByTestId('s')
    await fireEvent(track, 'layout', layout(200, 34))
    await fireEvent(track, 'responderGrant', touch(60))
    expect(track.props['aria-valuenow']).toBe(30)

    // The song ends under the finger; the next one starts from its top.
    await view.rerender(bar(2))
    expect(screen.getByTestId('s').props['aria-valuenow']).toBe(10)
    await fireEvent(track, 'responderMove', touch(160))
    await fireEvent(track, 'responderRelease', touch(160))
    expect(onCommit).not.toHaveBeenCalled()

    // A drag begun on the new song lands as ever.
    await fireEvent(track, 'responderGrant', touch(100))
    await fireEvent(track, 'responderRelease', touch(100))
    expect(onCommit).toHaveBeenCalledWith(50)
  })
})
