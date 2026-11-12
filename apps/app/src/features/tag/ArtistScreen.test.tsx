import { act, fireEvent, render, screen } from '@testing-library/react-native'
import type { Library } from '@selfmp3/shared'

import { ArtistScreen } from './ArtistScreen'

/**
 * "Make a tag from this artist", on an artist's ⋯: a tag that could not be
 * made says so, since making a tag has no word of its own when it fails.
 */

const mockLibrary = {
  songs: [
    { id: 1, artist: 'Aimer', tagIds: [] },
    { id: 2, artist: 'Aimer', tagIds: [] },
  ],
  tags: [],
  playlists: [],
  artistNames: {},
  artistNamesFound: [],
} as unknown as Library
const mockCreate = jest.fn()
const mockBulk = jest.fn()
jest.mock('@selfmp3/client', () => ({
  ...jest.requireActual<object>('@selfmp3/client'),
  useLibrary: () => ({ data: mockLibrary }),
  useCreateTag: () => ({ mutateAsync: mockCreate }),
  useBulkTag: () => ({ mutateAsync: mockBulk }),
}))
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ name: 'Aimer' }) }))
const mockFailure = jest.fn()
jest.mock('../../ui/toast', () => ({
  showToast: jest.fn(),
  showFailure: (...args: unknown[]) => mockFailure(...args),
}))
jest.mock('./useOpenTag', () => ({ useOpenTag: () => jest.fn() }))
jest.mock('./ArtistNamesEditor', () => ({ ArtistNamesEditor: () => null }))
jest.mock('./SameArtistCard', () => ({ SameArtistCard: () => null }))
// The page's ⋯, as the items it is given.
jest.mock('./PlacePage', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native')
  return {
    PlacePage: ({
      menuItems,
    }: {
      menuItems: { key: string; label: string; onPress: () => void }[]
    }) =>
      menuItems.map(item => (
        <Text key={item.key} onPress={item.onPress}>
          {item.label}
        </Text>
      )),
  }
})

it('says a tag that could not be made, and tags no songs', async () => {
  const refused = new Error('The server is busy')
  mockCreate.mockRejectedValue(refused)
  await render(<ArtistScreen />)
  await act(async () => fireEvent.press(screen.getByText('Make a tag from this artist')))
  expect(mockFailure).toHaveBeenCalledWith('Couldn’t make the tag', refused)
  expect(mockBulk).not.toHaveBeenCalled()
})
