import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { Song } from '@selfmp3/shared'

import { LikedScreen } from './LikedScreen'

const mockPlayFrom = jest.fn()
jest.mock('../../player/PlayerProvider', () => ({
  usePlayerCommands: () => ({ playFrom: mockPlayFrom, playShuffled: jest.fn() }),
}))

// Two liked songs, the newer like first.
const mockSongs = [1, 2].map(id => ({
  id,
  title: `Song ${id}`,
  hasArt: false,
  loved: true,
  lovedAt: `2026-10-0${3 - id} 10:00:00`,
  addedAt: '2026-10-01 09:00:00',
  restUntil: null,
})) as unknown as Song[]
jest.mock('@selfmp3/client', () => ({
  ...jest.requireActual('@selfmp3/client'),
  useLibrary: () => ({ data: { songs: mockSongs, tags: [] } }),
}))

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  usePathname: () => '/playlists/liked',
}))
jest.mock('../../shell/useLayout', () => {
  const layout = { wide: false, compact: true, dense: false, finePointer: false, width: 390 }
  return {
    useLayout: () => layout,
    useLayoutFlags: () => layout,
    useLayoutValue: (select: (value: typeof layout) => unknown) => select(layout),
    useWindowValue: (select: (value: object) => unknown) =>
      select({ width: 390, height: 844, scale: 3, fontScale: 1 }),
  }
})
jest.mock('../../offline/useArt', () => ({ useArt: () => () => null }))
jest.mock('../../ui/useSongColor', () => ({ useSongColor: () => ({ color: null }) }))
jest.mock('../../ui/useBackTo', () => ({
  goBack: jest.fn(),
  usePageBack: () => ({ shown: false }),
}))
jest.mock('../../ui/useHeroGrow', () => ({ useHeroGrow: () => ({ heroRef: { current: null } }) }))
jest.mock('../../ui/components/useListActions', () => ({ useListActions: () => [] }))
jest.mock('../../ui/components/MoreMenu', () => ({ MoreMenu: () => null }))
jest.mock('../../features/queue/useFlyToUpNext', () => ({ useFlyToUpNext: () => () => undefined }))
jest.mock('../playlists/PlaylistCover', () => ({ PlaylistCover: () => null }))
// The rows are the shared place page's; only the head, with Play, is Liked's own.
jest.mock('../tag/PlacePage', () => ({
  PlaceSongs: ({ head }: { head: ReactNode }) => head,
}))

describe('LikedScreen', () => {
  it('plays the whole list from Play, passing over a resting first song', async () => {
    await render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 0, left: 0, right: 0, bottom: 0 },
        }}
      >
        <LikedScreen />
      </SafeAreaProvider>,
    )
    await fireEvent.press(screen.getByTestId('liked-play'))
    expect(mockPlayFrom).toHaveBeenCalledWith([1, 2], 0, { source: { kind: 'liked' }, whole: true })
  })
})
