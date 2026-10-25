import { fireEvent, render, screen } from '@testing-library/react-native'
import type { View } from 'react-native'

import { Checkbox } from './Checkbox'
import { ProgressBar } from './ProgressBar'

/**
 * What the press is given, before React Native folds `aria-checked` into its
 * own state on a phone: on the web it is what the browser reads.
 */
const mockPressed: Record<string, unknown>[] = []
jest.mock('./Press', () => {
  const { createElement, forwardRef } = jest.requireActual<typeof import('react')>('react')
  const { Pressable } = jest.requireActual<typeof import('react-native')>('react-native')
  return {
    Press: forwardRef<View, Record<string, unknown>>((props, ref) => {
      mockPressed.push(props)
      return createElement(Pressable, { ...props, ref })
    }),
  }
})

/**
 * The parts that say what they are to a screen reader in a browser, where
 * react-native-web drops `accessibilityState` and `accessibilityValue`: a
 * checkbox says it is ticked (or half), a progress bar how far along it is.
 */
describe('Checkbox', () => {
  it('is the control when given onChange: its role, its state, its name', async () => {
    const onChange = jest.fn()
    await render(<Checkbox checked={false} mixed onChange={onChange} label="Select all 3 songs" />)
    const box = screen.getByRole('checkbox', { name: 'Select all 3 songs' })
    expect(box.props['accessibilityState']).toEqual({ checked: 'mixed' })
    expect(mockPressed.at(-1)?.['aria-checked']).toBe('mixed')

    await fireEvent.press(box)
    expect(onChange).toHaveBeenCalledWith(true, expect.anything())
  })

  it('says a ticked box is ticked', async () => {
    await render(<Checkbox checked onChange={() => undefined} label="Deselect Evening" />)
    expect(screen.getByRole('checkbox', { name: 'Deselect Evening' })).toBeTruthy()
    expect(mockPressed.at(-1)?.['aria-checked']).toBe(true)
  })
})

describe('ProgressBar', () => {
  it('says how far along it is, as a whole percent', async () => {
    await render(<ProgressBar fraction={1 / 3} label="Songs imported" testID="bar" />)
    const bar = screen.getByTestId('bar')
    expect(bar.props['aria-valuenow']).toBe(33)
    expect(bar.props['accessibilityValue']).toEqual({ min: 0, max: 100, now: 33 })
  })
})
