import { fireEvent, render, screen } from '@testing-library/react-native'

import { Chip } from './Chip'

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

  it('calls back when tapped', async () => {
    const onPress = jest.fn()
    await render(<Chip label="yoasobi" selected={false} onPress={onPress} />)
    fireEvent.press(screen.getByRole('button', { name: 'yoasobi' }))
    expect(onPress).toHaveBeenCalledTimes(1)
  })
})
