import { Text } from 'react-native'
import { fireEvent, render, screen } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { Song } from '@selfmp3/shared'

import { OverlayProvider } from '../../shell/Overlay'

import { MoreMenu } from './MoreMenu'
import { SongActionItems } from './SongActionItems'
import { useListActions } from './useListActions'

/**
 * What is done to songs, from a song's menu, the selection bar's More and a
 * list page's ⋯: one set of doings.
 *
 * 986c1605 found the bar's Download going by another path than the menu's,
 * so songs removed by hand downloaded straight back; and the answer page's
 * Add to Up next played its songs next instead (T-383).
 */

jest.mock('expo-router', () => ({ useRouter: () => ({ navigate: jest.fn(), push: jest.fn() }) }))

const mockRequestDownload = jest.fn()
const mockAddToQueue = jest.fn()
const mockPlayNext = jest.fn()
jest.mock('@selfmp3/client', () => ({
  ...jest.requireActual('@selfmp3/client'),
  useLibrary: () => ({ data: { songs: [], playlists: [], tags: [] } }),
  useManifest: () => ({ data: undefined }),
  useAddToPlaylist: () => ({ mutate: jest.fn() }),
  useBulkLoved: () => ({ mutate: jest.fn() }),
  useCreatePlaylist: () => ({ mutateAsync: jest.fn() }),
}))
jest.mock('../../connection/ConnectionProvider', () => ({
  useConnection: () => ({ fromCloud: false, needsStorage: false }),
}))
jest.mock('../../offline/DownloadsProvider', () => ({
  useDownloads: () => ({
    state: {
      index: {
        version: 1,
        entries: { '1': { songId: 1, fileName: '1.m4a', sizeBytes: 1, etag: 'e' } },
      },
    },
    installed: true,
    removing: false,
    requestDownload: mockRequestDownload,
  }),
}))
jest.mock('../../offline/useDownloadRemoval', () => ({ useDownloadRemoval: () => jest.fn() }))
jest.mock('../../features/playlists/usePlaylistRemoval', () => ({
  usePlaylistRemoval: () => jest.fn(),
}))
jest.mock('../../features/queue/useFlyToUpNext', () => ({ useFlyToUpNext: () => jest.fn() }))
jest.mock('../../player/PlayerProvider', () => ({
  usePlayerCommands: () => ({
    addToQueue: mockAddToQueue,
    playNext: mockPlayNext,
    playFrom: jest.fn(),
  }),
}))

const song = (id: number): Song =>
  ({ id, title: `Song ${id}`, artist: 'Klara Feld', loved: false, tagIds: [] }) as unknown as Song

describe('one set of doings', () => {
  beforeEach(() => jest.clearAllMocks())

  it('downloads ticked songs by hand, as one song’s menu does', async () => {
    await render(
      <SongActionItems
        songs={[song(1), song(2), song(3)]}
        onClose={() => undefined}
        onTags={() => undefined}
        onDelete={() => undefined}
      />,
    )
    await fireEvent.press(screen.getByRole('menuitem', { name: 'Download the rest' }))
    expect(mockRequestDownload).toHaveBeenCalledWith([1, 2, 3])
    expect(screen.getByRole('menuitem', { name: 'Remove 1 from this phone' })).toBeTruthy()
  })

  function Page(): React.ReactNode {
    const items = useListActions([2, 3])
    return (
      <>
        <Text>Evening</Text>
        <MoreMenu name="Evening" items={items} testID="page-more" />
      </>
    )
  }

  it('adds a page’s songs to the end of Up next from its ⋯, and plays them next only when asked', async () => {
    await render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 47, left: 0, right: 0, bottom: 34 },
        }}
      >
        <OverlayProvider>
          <Page />
        </OverlayProvider>
      </SafeAreaProvider>,
    )
    await fireEvent.press(screen.getByRole('button', { name: 'More actions for Evening' }))
    await fireEvent.press(await screen.findByRole('menuitem', { name: 'Add to Up next' }))
    expect(mockAddToQueue).toHaveBeenCalledWith([2, 3])
    expect(mockPlayNext).not.toHaveBeenCalled()

    await fireEvent.press(screen.getByRole('button', { name: 'More actions for Evening' }))
    await fireEvent.press(await screen.findByRole('menuitem', { name: 'Play next' }))
    expect(mockPlayNext).toHaveBeenCalledWith([2, 3])
  })
})
