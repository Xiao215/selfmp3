import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { StyleSheet } from 'react-native'
import { leading, type } from '@selfmp3/client'

import { ListHeadName } from './ListHead'

const layout = (width: number, height: number) => ({
  nativeEvent: { layout: { x: 0, y: 0, width, height } },
})

/** Lays the name out at 320 points, its copies taking `lines` lines at display, page and large. */
async function measure(lines: [number, number, number]): Promise<void> {
  const name = screen.getByTestId('name')
  await act(async () => fireEvent(name.parent!, 'layout', layout(320, 100)))
  const steps = ['display', 'page', 'large'] as const
  for (const [at, step] of steps.entries()) {
    const copy = screen.getByTestId(`name-${step}`, { includeHiddenElements: true })
    await act(async () =>
      fireEvent(
        copy,
        'layout',
        layout(320, Math.ceil(type[step] / 4) + lines[at]! * leading[step]),
      ),
    )
  }
}

const shown = () => StyleSheet.flatten(screen.getByTestId('name').props['style'])

/** A place's own page shows its whole name, a size down rather than cut (AC1). */
describe('ListHeadName', () => {
  it('keeps a name that fits two lines at its own size', async () => {
    await render(<ListHeadName name="night" testID="name" />)
    await measure([1, 1, 1])
    expect(shown().fontSize).toBe(type.display)
    expect(screen.getByTestId('name').props['numberOfLines']).toBe(2)
  })

  it('steps down to the first size that fits two lines', async () => {
    await render(<ListHeadName name="late night drives with the windows down" testID="name" />)
    await measure([3, 2, 2])
    expect(shown().fontSize).toBe(type.page)
  })

  it('wraps freely at the last size rather than cutting', async () => {
    await render(<ListHeadName name={'a very long name '.repeat(6)} testID="name" />)
    await measure([5, 4, 3])
    expect(shown().fontSize).toBe(type.large)
    expect(screen.getByTestId('name').props['numberOfLines']).toBeUndefined()
  })
})
