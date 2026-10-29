import { act, renderHook } from '@testing-library/react-native'

import { useLiftScale } from './HoldToReorder'

jest.mock('../../ports/haptics', () => ({ lightTap: () => undefined }))

/** The scale's value now, as the row wearing it would be drawn. */
const scaleOf = (lift: { lift: { __getValue: () => number } }): number => lift.lift.__getValue()

describe('the lift a held row wears', () => {
  it('is put back to rest when the row it was settling on goes as it is set down', async () => {
    // Dragged out of the rail: the row and the copy both go in the drop's
    // commit, and the spring is stopped at the full lift.
    const { result } = await renderHook(() => useLiftScale())
    await act(async () => result.current.start(7))
    await act(async () => result.current.lift.setValue(1.04))
    expect(result.current.wearing).toBe(7)

    await act(async () => {
      result.current.drop()
      result.current.lift.stopAnimation()
    })
    expect(scaleOf(result.current as never)).toBe(1)
    // Nothing wears it: the song, added again, is drawn at its own size.
    expect(result.current.wearing).toBeNull()
  })

  it('leaves the next hold alone when the last drop’s settle is cut short by it', async () => {
    const { result } = await renderHook(() => useLiftScale())
    await act(async () => result.current.start(7))
    await act(async () => result.current.drop())
    // The next row is held before the settle is over; its swell stops the spring.
    await act(async () => result.current.holding(8, true))
    expect(result.current.wearing).toBe(8)
  })
})
