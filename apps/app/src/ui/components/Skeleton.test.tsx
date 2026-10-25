import { act, render, screen } from '@testing-library/react-native'

import { MOVE_MS } from '../motion.model'
import { Bone, Skeleton } from './Skeleton'

/** Loading shapes wait before they show, so a quick answer never flashes them (AA1). */
describe('Skeleton', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('stays hidden until the wait is over, then says it is loading', async () => {
    await render(
      <Skeleton label="Loading songs">
        <Bone height={12} />
      </Skeleton>,
    )
    expect(screen.queryByLabelText('Loading songs')).toBeNull()
    await act(() => jest.advanceTimersByTime(MOVE_MS.skeletonWait - 1))
    expect(screen.queryByLabelText('Loading songs')).toBeNull()
    await act(() => jest.advanceTimersByTime(1))
    expect(screen.getByLabelText('Loading songs')).toBeTruthy()
  })
})
