import { act, fireEvent, render, screen } from '@testing-library/react-native'
import type { Song } from '@selfmp3/shared'

import { AddSongsSheet } from './AddSongsSheet'

/**
 * A song pressed in Add songs says "Added" while it goes, and stops saying so
 * when it did not go: a failed add left the row ticked over a song the
 * playlist never got.
 */

type Sent = { onError?: () => void }
// What the last send was told to do if it fails, which the test then makes it.
let mockSent: Sent | undefined
const mockSend = (_input: unknown, sent?: Sent): void => {
  mockSent = sent
}
jest.mock('@selfmp3/client', () => ({
  ...jest.requireActual('@selfmp3/client'),
  useAddToPlaylist: () => ({ mutate: mockSend }),
  useBulkTag: () => ({ mutate: mockSend }),
}))
jest.mock('../../ui/components/Sheet', () => ({
  Sheet: ({ children }: { children: unknown }) => children,
}))

const mockSong = { id: 7, title: 'Song 7' } as unknown as Song

// The picker as a single row: what it says of the song, and its +.
jest.mock('../../ui/components/LibrarySongPicker', () => ({
  LibrarySongPicker: ({
    stateOf,
    onAdd,
  }: {
    stateOf: (song: Song) => string
    onAdd: (song: Song) => void
  }) => {
    const { Pressable, Text } = jest.requireActual<typeof import('react-native')>('react-native')
    return (
      <Pressable testID="pick" onPress={() => onAdd(mockSong)}>
        <Text>{stateOf(mockSong)}</Text>
      </Pressable>
    )
  },
}))

const sheet = (
  <AddSongsSheet
    open
    onClose={() => undefined}
    targetName="Night"
    target={{ kind: 'existing', playlistId: 1, inPlaylist: new Set() }}
  />
)

it('takes the tick back when the add fails', async () => {
  await render(sheet)
  await fireEvent.press(screen.getByTestId('pick'))
  expect(screen.getByText('added')).toBeTruthy()
  await act(async () => mockSent?.onError?.())
  expect(screen.getByText('add')).toBeTruthy()
})
