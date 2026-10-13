import { fireEvent, render, screen } from '@testing-library/react-native'
import type { Song } from '@selfmp3/shared'

import { LikeButton } from './LikeButton'

/**
 * The song's heart, which four places built by hand and two of them without
 * the room guard: a friend's song in a room is not yours to like.
 */

const mockToggleLoved = jest.fn()
jest.mock('@selfmp3/client', () => ({
  ...jest.requireActual('@selfmp3/client'),
  useToggleLoved: () => ({ mutate: mockToggleLoved }),
}))
jest.mock('../../shell/useLayout', () => {
  const layout = { wide: false, dense: false, compact: true, finePointer: false, width: 390 }
  return { useLayoutValue: (select: (value: typeof layout) => unknown) => select(layout) }
})

const SONG = { id: 4, title: 'Nocturne', loved: false } as unknown as Song

describe('LikeButton', () => {
  it('likes a song, and unlikes a loved one', async () => {
    const view = await render(<LikeButton song={SONG} />)
    await fireEvent.press(screen.getByRole('button', { name: 'Like' }))
    expect(mockToggleLoved).toHaveBeenCalledWith({ id: 4, loved: true })

    await view.rerender(<LikeButton song={{ ...SONG, loved: true }} filled />)
    expect(screen.getByRole('button', { name: 'Unlike' })).toBeTruthy()
  })

  it('draws nothing for a friend’s song in a room', async () => {
    await render(<LikeButton song={{ ...SONG, id: -42 }} filled />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
