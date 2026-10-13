import { act, fireEvent, render, screen } from '@testing-library/react-native'

import { ListenBar } from './ImportListen'

/** A bar 200 wide: a finger at x is x / 200 of the song along. */
const WIDTH = 200

const touch = (x: number) => ({ nativeEvent: { locationX: x }, touchHistory: { touchBank: [] } })

/** Where the bar shows the preview to be, in seconds. */
const shownAt = (): number => Number(screen.getByTestId('listen-bar').props['aria-valuenow'])

/**
 * The preview's bar on a review or a search: dragged back and let go, it
 * stays where the finger left it while the player still reports the old
 * place, as the song page's bar does (SeekBar's `useSeekHold`).
 */
describe('the preview bar', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  const draw = async (position: number, onSeek: (seconds: number) => void) => {
    const view = await render(<ListenBar position={position} duration={100} onSeek={onSeek} />)
    await fireEvent(screen.getByTestId('listen-bar'), 'layout', {
      nativeEvent: { layout: { width: WIDTH, height: 34, x: 0, y: 0 } },
    })
    return view
  }

  it('holds where it was let go while the player still says the old place, then follows the player', async () => {
    const onSeek = jest.fn()
    const view = await draw(60, onSeek)
    const bar = screen.getByTestId('listen-bar')
    await fireEvent(bar, 'responderGrant', touch(120))
    await fireEvent(bar, 'responderMove', touch(80))
    await fireEvent(bar, 'responderRelease', touch(80))
    expect(onSeek).toHaveBeenCalledWith(40)

    // The player has not got there yet: it still reports 60.
    await view.rerender(<ListenBar position={60.25} duration={100} onSeek={onSeek} />)
    expect(shownAt()).toBe(40)

    // Once it is there, the bar follows it again.
    await view.rerender(<ListenBar position={40.5} duration={100} onSeek={onSeek} />)
    expect(shownAt()).toBe(41)
    await act(async () => {
      jest.advanceTimersByTime(4500)
    })
    await view.rerender(<ListenBar position={45} duration={100} onSeek={onSeek} />)
    expect(shownAt()).toBe(45)
  })

  it('lets go of the hold after a second, for a seek the player never reports', async () => {
    const view = await draw(60, () => undefined)
    const bar = screen.getByTestId('listen-bar')
    await fireEvent(bar, 'responderGrant', touch(80))
    await fireEvent(bar, 'responderRelease', touch(80))
    await view.rerender(<ListenBar position={60} duration={100} onSeek={() => undefined} />)
    expect(shownAt()).toBe(40)
    await act(async () => {
      jest.advanceTimersByTime(1100)
    })
    expect(shownAt()).toBe(60)
  })
})
