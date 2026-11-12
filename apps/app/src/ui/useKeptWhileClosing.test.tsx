import { renderHook } from '@testing-library/react-native'
import { useKeptWhileClosing } from './motion'

/** What a closing thing still draws, as its callers use it. */
describe('useKeptWhileClosing', () => {
  it('settles on a value its caller makes anew every render', async () => {
    // The resume offer and the sidebar's notice are objects built in the
    // render: drawn again while one was open, this threw "Too many re-renders".
    const { result, rerender } = await renderHook(() =>
      useKeptWhileClosing(true, { song: '夜に駆ける' }),
    )
    await rerender({})
    expect(result.current).toEqual({ song: '夜に駆ける' })
  })

  it('keeps the last open value once closed', async () => {
    const { result, rerender } = await renderHook(
      ({ open, value }: { open: boolean; value: string | null }) =>
        useKeptWhileClosing(open, value),
      { initialProps: { open: true, value: 'From iPhone' as string | null } },
    )
    await rerender({ open: true, value: 'From Mac' })
    await rerender({ open: false, value: null })
    expect(result.current).toBe('From Mac')
    await rerender({ open: true, value: 'From iPad' })
    expect(result.current).toBe('From iPad')
  })
})
