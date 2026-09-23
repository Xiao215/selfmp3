import { fireEvent, render, screen } from '@testing-library/react-native'

import { Button } from './Button'

/**
 * The first component test, and the reason foundation 8 splits the runners.
 *
 * This renders a real component tree with React Native's own renderer, which
 * vitest cannot do. It needs no simulator and no device — jest-expo gives it
 * enough of a platform to mount against.
 *
 * `render` is awaited: React Native Testing Library 14 returns a promise, so a
 * test that forgets gets an empty object and the baffling "render function has
 * not been called" from every query after it.
 */
describe('Button', () => {
  it('is reachable by its label', async () => {
    await render(<Button label="Shuffle" onPress={() => undefined} />)
    expect(screen.getByRole('button', { name: 'Shuffle' })).toBeTruthy()
  })

  it('calls back when pressed', async () => {
    const onPress = jest.fn()
    await render(<Button label="Play" onPress={onPress} />)
    await fireEvent.press(screen.getByRole('button', { name: 'Play' }))
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('does nothing when it is disabled', async () => {
    const onPress = jest.fn()
    await render(<Button label="Play" onPress={onPress} disabled />)
    await fireEvent.press(screen.getByRole('button', { name: 'Play' }))
    expect(onPress).not.toHaveBeenCalled()
  })

  it('does nothing while it is busy', async () => {
    // Busy is not the same as disabled: the control still looks live, and the
    // reason it must not fire again is that the first press is still running.
    const onPress = jest.fn()
    await render(<Button label="Sign in" onPress={onPress} busy />)
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }))
    expect(onPress).not.toHaveBeenCalled()
  })
})
