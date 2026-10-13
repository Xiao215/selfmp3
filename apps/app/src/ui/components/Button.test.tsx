import { fireEvent, render, screen } from '@testing-library/react-native'
import { Text } from 'react-native'
import { iconSize } from '@selfmp3/client'

import { Button, PlayButton } from './Button'

/** A glyph that says the size it was drawn at. */
function Probe({ size }: { size?: number }) {
  return <Text testID="probe">{String(size)}</Text>
}

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

  it('draws its glyph at its own size, whatever the caller wrote', async () => {
    // Each caller sized its own and they drifted: 13, 15 and 16 on the same
    // regular button. The button decides now.
    await render(<Button label="Add" icon={<Probe size={16} />} onPress={() => undefined} />)
    expect(screen.getByTestId('probe')).toHaveTextContent(String(iconSize.button))
  })

  it("draws a small one's a step down", async () => {
    await render(<Button label="Retry" size="small" icon={<Probe />} onPress={() => undefined} />)
    expect(screen.getByTestId('probe')).toHaveTextContent(String(iconSize.sub))
  })
})

describe('PlayButton', () => {
  it('sizes a glyph given none to its round', async () => {
    await render(<PlayButton label="Play" icon={<Probe />} onPress={() => undefined} />)
    expect(screen.getByTestId('probe')).toHaveTextContent(String(iconSize.hero))
  })

  it('leaves a glyph its caller sized', async () => {
    await render(<PlayButton label="Play" icon={<Probe size={30} />} onPress={() => undefined} />)
    expect(screen.getByTestId('probe')).toHaveTextContent('30')
  })
})
