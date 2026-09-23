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

  it("is white when it is chosen, whatever the tag's hue", async () => {
    // Nine tags in nine hues read as one quiet row; the chosen ones are lit,
    // and two chosen tags of different hues look the same.
    await render(
      <>
        <Chip testID="off" label="chill" hue={150} selected={false} onPress={() => undefined} />
        <Chip testID="on" label="hype" hue={150} selected onPress={() => undefined} />
        <Chip testID="on2" label="study" hue={20} selected onPress={() => undefined} />
      </>,
    )
    const off = boxOf('off')
    const on = boxOf('on')
    expect(on['backgroundColor']).not.toBe(off['backgroundColor'])
    expect(boxOf('on2')['backgroundColor']).toBe(on['backgroundColor'])
    // No edge on either: separation is tone.
    expect(off['borderWidth'] ?? 0).toBe(0)
  })

  it('calls back when tapped', async () => {
    const onPress = jest.fn()
    await render(<Chip label="yoasobi" selected={false} onPress={onPress} />)
    await fireEvent.press(screen.getByRole('button', { name: 'yoasobi' }))
    expect(onPress).toHaveBeenCalledTimes(1)
  })
})
