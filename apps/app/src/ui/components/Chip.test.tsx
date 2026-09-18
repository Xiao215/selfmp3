import { fireEvent, render, screen } from '@testing-library/react-native'
import { StyleSheet } from 'react-native'

import { Chip } from './Chip'

/** A chip's own box, flattened, so its fill and its edge can be compared. */
function boxOf(testID: string): Record<string, unknown> {
  return StyleSheet.flatten(screen.getByTestId(testID).props['style']) as Record<string, unknown>
}

/**
 * The tag chip, which is the one control in the library that carries state a
 * reader cannot see any other way: whether this tag is filtering the list.
 */
describe('Chip', () => {
  it('says whether it is the one filtering the list', async () => {
    await render(<Chip label="yoasobi" selected onPress={() => undefined} />)
    // Selected has to be announced, not only drawn. A chip that is merely a
    // different colour says nothing to anyone who cannot see the colour.
    expect(
      screen.getByRole('button', { name: 'yoasobi' }).props['accessibilityState'],
    ).toMatchObject({
      selected: true,
    })
  })

  it('is not selected by default', async () => {
    await render(<Chip label="reference" selected={false} onPress={() => undefined} />)
    expect(
      screen.getByRole('button', { name: 'reference' }).props['accessibilityState'],
    ).toMatchObject({ selected: false })
  })

  it('is filled when it is chosen and hollow when it is not', async () => {
    // The owner could not tell nine tinted pills apart on a phone when the
    // only difference was a step of brightness. The two states are now two
    // shapes: no fill at all, or the hue filled in.
    await render(
      <>
        <Chip testID="off" label="chill" hue={150} selected={false} onPress={() => undefined} />
        <Chip testID="on" label="hype" hue={150} selected onPress={() => undefined} />
      </>,
    )
    const off = boxOf('off')
    const on = boxOf('on')
    expect(off['backgroundColor']).toBe('transparent')
    expect(on['backgroundColor']).not.toBe('transparent')
    expect(on['borderColor']).not.toBe(off['borderColor'])
  })

  it('calls back when tapped', async () => {
    const onPress = jest.fn()
    await render(<Chip label="yoasobi" selected={false} onPress={onPress} />)
    fireEvent.press(screen.getByRole('button', { name: 'yoasobi' }))
    expect(onPress).toHaveBeenCalledTimes(1)
  })
})
