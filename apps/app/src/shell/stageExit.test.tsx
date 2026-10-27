import { act, renderHook } from '@testing-library/react-native'

import { leaveStage, setStageExit, useStageLeaving } from './stageExit'

/**
 * Putting Now Playing away: the page is told it is leaving the moment its exit
 * starts, so it stops taking touches then, not once it is gone (R2-m16).
 */
describe('leaveStage', () => {
  afterEach(() => setStageExit(null))

  it('marks the page leaving for its exit, and navigates once it lands', async () => {
    let done: ((finished: boolean) => void) | undefined
    setStageExit(next => {
      done = next
    })
    const navigate = jest.fn()
    const leaving = await renderHook(() => useStageLeaving())
    expect(leaving.result.current).toBe(false)

    await act(() => leaveStage(navigate))
    expect(leaving.result.current).toBe(true)
    expect(navigate).not.toHaveBeenCalled()

    await act(() => done?.(true))
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(leaving.result.current).toBe(false)
  })

  it('gives the page its touches back when the exit is stopped', async () => {
    let done: ((finished: boolean) => void) | undefined
    setStageExit(next => {
      done = next
    })
    const navigate = jest.fn()
    const leaving = await renderHook(() => useStageLeaving())

    await act(() => leaveStage(navigate))
    await act(() => done?.(false))
    expect(leaving.result.current).toBe(false)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('starts one exit for two quick presses', async () => {
    const leave = jest.fn()
    setStageExit(leave)
    const navigate = jest.fn()
    leaveStage(navigate)
    leaveStage(navigate)
    expect(leave).toHaveBeenCalledTimes(1)
  })
})
