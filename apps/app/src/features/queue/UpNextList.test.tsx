import { Text } from 'react-native'
import { act, fireEvent, render, screen } from '@testing-library/react-native'
import type { Song } from '@selfmp3/shared'

import type { QueueRow } from './queue.model'
import { UpNextList } from './UpNextParts'

/**
 * Up next's list, which the phone's sheet and the computer's rail both draw.
 * The sheet stopped at sixty songs to come and ten played, and the rest of a
 * shuffled library could not be reached from it (T-379); it now draws the
 * rows in view of the whole queue, as the rail did.
 */

const rows = (from: number, count: number): QueueRow[] =>
  Array.from({ length: count }, (_, at) => ({
    song: { id: from + at, title: `Song ${from + at}` } as unknown as Song,
    index: from + at,
  }))

const ROW = 64

describe('UpNextList', () => {
  it('draws the rows in view, and the last of a long queue once scrolled to', async () => {
    const next = rows(1, 500)
    await render(
      <UpNextList
        testID="list"
        next={next}
        played={rows(501, 20)}
        rowHeight={ROW}
        scrollEnabled
        renderRow={row => <Text>{row.song.title}</Text>}
      />,
    )
    const list = screen.getByTestId('list')
    await fireEvent(list, 'layout', { nativeEvent: { layout: { width: 390, height: 640 } } })

    expect(screen.getByText('Song 1')).toBeTruthy()
    expect(screen.getByText('Song 20')).toBeTruthy()
    expect(screen.queryByText('Song 400')).toBeNull()

    await act(async () => {
      await fireEvent.scroll(list, { nativeEvent: { contentOffset: { y: 499 * ROW } } })
    })
    expect(screen.getByText('Song 500')).toBeTruthy()
    expect(screen.getByText('Played')).toBeTruthy()
    expect(screen.getByText('Song 520')).toBeTruthy()
    expect(screen.queryByText('Song 1')).toBeNull()
  })
})
