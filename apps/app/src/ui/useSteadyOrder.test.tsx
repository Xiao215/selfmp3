import { renderHook } from '@testing-library/react-native'
import { useSteadyOrder } from './useSteadyOrder'

const same = (name: string): string => name

it('holds the order for a visit, and takes the new one on the next visit', async () => {
  const { result, rerender } = await renderHook(
    ({ next, visit }: { next: readonly string[]; visit: number }) =>
      useSteadyOrder(next, same, true, visit),
    { initialProps: { next: ['night', 'focus', 'live'], visit: 1 } },
  )
  // Songs tagged "live": by count it would lead now, but not on this visit (X6).
  await rerender({ next: ['live', 'night', 'focus'], visit: 1 })
  expect(result.current).toEqual(['night', 'focus', 'live'])
  await rerender({ next: ['live', 'night', 'focus'], visit: 2 })
  expect(result.current).toEqual(['live', 'night', 'focus'])
})
