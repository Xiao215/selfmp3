import { act, renderHook } from '@testing-library/react-native'
import type { Tag } from '@selfmp3/shared'

import { useNewTagForm } from './useNewTagForm'

/**
 * The new-tag form the sidebar and the Tags page share: a name that is
 * already a tag's opens it, a refusal keeps the name and says so, and a tag
 * made clears the form for the next.
 */

const mockCreate = jest.fn()
let mockRefuse = false

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock('@selfmp3/client', () => {
  // A mutation with the state react-query keeps, so a refusal re-renders as it does.
  const { useState } = jest.requireActual<typeof import('react')>('react')
  return {
    ...jest.requireActual('@selfmp3/client'),
    useLibrary: () => ({ data: undefined }),
    useCreateTag: () => {
      const [state, setState] = useState({ isPending: false, isError: false })
      return {
        ...state,
        reset: () => setState({ isPending: false, isError: false }),
        mutateAsync: async (tag: { name: string; hue?: number }) => {
          mockCreate(tag)
          if (mockRefuse) {
            setState({ isPending: false, isError: true })
            throw new Error('refused')
          }
          return { id: 9, ...tag }
        },
      }
    },
  }
})

const LATE: Tag = { id: 1, name: 'Late night', hue: 200, songCount: 3 } as Tag

describe('useNewTagForm', () => {
  beforeEach(() => {
    mockCreate.mockClear()
    mockRefuse = false
  })

  it('opens the tag that is already there, whatever its case and spaces, and makes nothing', async () => {
    const onExisting = jest.fn()
    const hook = await renderHook(() => useNewTagForm({ tags: [LATE], onExisting }))
    await act(() => hook.result.current.setName('  late   NIGHT '))
    await act(() => hook.result.current.submit())
    expect(onExisting).toHaveBeenCalledWith(LATE)
    expect(mockCreate).not.toHaveBeenCalled()
    expect(hook.result.current.name).toBe('')
  })

  it('keeps the name and says so when the server refuses it', async () => {
    mockRefuse = true
    const onMade = jest.fn()
    const hook = await renderHook(() => useNewTagForm({ tags: [], onExisting: jest.fn(), onMade }))
    await act(() => hook.result.current.setName('gym'))
    await act(async () => hook.result.current.submit())
    expect(mockCreate).toHaveBeenCalledWith({ name: 'gym' })
    expect(hook.result.current.failed).toBe(true)
    expect(hook.result.current.name).toBe('gym')
    expect(onMade).not.toHaveBeenCalled()

    // Typing again takes the refusal back.
    await act(() => hook.result.current.setName('gym2'))
    expect(hook.result.current.failed).toBe(false)
  })

  it('offers a colour far from the tags there are, as the server would give it', async () => {
    const red = { ...LATE, id: 2, name: 'live', hue: 0 }
    const orange = { ...LATE, id: 3, name: 'rock', hue: 22 }
    const hook = await renderHook(() =>
      useNewTagForm({ tags: [red, orange], onExisting: jest.fn() }),
    )
    await act(() => hook.result.current.setName('calm'))
    expect(hook.result.current.hue).toBe(192)
  })

  it('makes it in the colour picked, then clears for the next', async () => {
    const onMade = jest.fn()
    const hook = await renderHook(() => useNewTagForm({ tags: [], onExisting: jest.fn(), onMade }))
    await act(() => hook.result.current.setName('chill'))
    expect(hook.result.current.hue).toBe(hook.result.current.autoHue)
    await act(() => hook.result.current.setHue(40))
    await act(async () => hook.result.current.submit())
    expect(mockCreate).toHaveBeenCalledWith({ name: 'chill', hue: 40 })
    expect(onMade).toHaveBeenCalled()
    expect(hook.result.current.name).toBe('')
    expect(hook.result.current.hue).toBe(hook.result.current.autoHue)
  })
})
