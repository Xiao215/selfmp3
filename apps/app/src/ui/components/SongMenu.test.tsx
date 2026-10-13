import { fireEvent, render, screen } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { Song } from '@selfmp3/shared'

import { OverlayProvider } from '../../shell/Overlay'
import { SongMenu } from './SongMenu'

/**
 * A song's ⋯ menu (docs/ui-mock `P14`): what is in it and in what order — the
 * same everywhere a song is (B1) — where Song details goes, and what "remove"
 * means on the device it is open on.
 *
 * The owner's words: "delete from library means delete from local too": one
 * action behind one confirmation, the same dialog the selection bar asks with.
 *
 * "Remove from this phone", which keeps the song and frees the room, is a separate
 * wish and has to survive both.
 */

// Song details and a tag chip go to pages; the real router needs an app round it.
const mockNavigate = jest.fn()
jest.mock('expo-router', () => ({ useRouter: () => ({ navigate: mockNavigate }) }))

const mockDeleteSong = jest.fn()
const mockForgetSongs = jest.fn()
const mockRemoveByHand = jest.fn(() => Promise.resolve())
const mockDropDownloads = jest.fn(() => Promise.resolve())
let mockIndex: { version: 1; entries: Record<string, unknown> }

jest.mock('@selfmp3/client', () => ({
  ...jest.requireActual('@selfmp3/client'),
  useLibrary: () => ({ data: { songs: [], playlists: [], tags: [] } }),
  useAddToPlaylist: () => ({ mutate: jest.fn() }),
  useBulkLoved: () => ({ mutate: jest.fn() }),
  useCreatePlaylist: () => ({ mutateAsync: jest.fn() }),
  useBulkDeleteSongs: () => ({ mutate: mockDeleteSong, isPending: false }),
  useToggleLoved: () => ({ mutate: jest.fn() }),
  clientApi: () => ({ similar: () => Promise.resolve({ songs: [] }) }),
}))
jest.mock('../../offline/DownloadsProvider', () => ({
  useDownloads: () => ({
    state: { index: mockIndex },
    installed: true,
    requestDownload: jest.fn(),
    removeByHand: mockRemoveByHand,
    dropDownloads: mockDropDownloads,
  }),
  useDownloadProgress: () => ({ activeSongId: null, bytesWritten: 0, totalBytes: 0 }),
}))
jest.mock('../../features/playlists/usePlaylistRemoval', () => ({
  usePlaylistRemoval: () => jest.fn(),
}))
jest.mock('../../offline/useArt', () => ({ useArt: () => () => null }))
jest.mock('../../player/PlayerProvider', () => ({
  usePlayerCommands: () => ({
    playNext: jest.fn(),
    addToQueue: jest.fn(),
    playFrom: jest.fn(),
    forgetSongs: mockForgetSongs,
  }),
  usePlayer: () => ({ sleepAtSongEnd: false, sleepTimerEndsAt: null }),
}))
jest.mock('../../shell/useLayout', () => {
  const layout = { wide: false, dense: false, compact: true, finePointer: false, width: 390 }
  return {
    useLayout: () => layout,
    useLayoutValue: (select: (value: typeof layout) => unknown) => select(layout),
    useWindowValue: (select: (value: object) => unknown) =>
      select({ width: 390, height: 844, scale: 3, fontScale: 1 }),
  }
})

const SONG = {
  id: 4,
  title: 'Nocturne',
  artist: 'Klara Feld',
  duration: 224,
  sizeBytes: 4_000_000,
  loved: false,
  tagIds: [],
} as unknown as Song

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
}

const draw = (
  onClose: () => void = () => undefined,
  {
    song = SONG,
    context,
    extras,
  }: {
    song?: Song
    context?: 'nowPlaying'
    extras?: { onSleep: () => void; onDevices: () => void }
  } = {},
) =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <OverlayProvider>
        <SongMenu song={song} onClose={onClose} context={context} extras={extras} />
      </OverlayProvider>
    </SafeAreaProvider>,
  )

/** The words inside an element, as a reader would hear its name. */
interface Node {
  readonly children: readonly (string | Node)[]
}
const textOf = (node: Node): string =>
  node.children.map(child => (typeof child === 'string' ? child : textOf(child))).join('')

/** The menu's items, top to bottom, by name. */
const itemNames = (): string[] => screen.getAllByRole('menuitem').map(textOf)

const downloaded = {
  version: 1 as const,
  entries: {
    '4': {
      songId: 4,
      fileName: '4.m4a',
      sizeBytes: 4_000_000,
      etag: 'etag-4',
      downloadedAt: '2026-01-01T00:00:00.000Z',
    },
  },
}

describe('what the menu offers', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockIndex = { version: 1, entries: {} }
  })

  it('names the song, lists one order, and leaves Play next and Select to other places', async () => {
    await draw()

    expect(screen.getByText('Nocturne')).toBeTruthy()
    expect(screen.getByText('Klara Feld · 3:44')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Like' })).toBeTruthy()
    // From the start of the name: the › after Add to playlist is part of it.
    const order = [
      /^Tags…$/,
      /^Add to playlist/,
      /^Add to Up next$/,
      /^Play similar songs$/,
      /^Download$/,
      /^Song details$/,
      /^Delete from library…$/,
    ]
    const names = itemNames()
    expect(names).toHaveLength(order.length)
    order.forEach((name, at) => expect(names[at]).toMatch(name))
    expect(screen.queryByRole('menuitem', { name: 'Play next' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Select' })).toBeNull()
  })

  it('on Now Playing, leaves out what the page shows and ends with the sleep timer and Devices', async () => {
    const onSleep = jest.fn()
    const onDevices = jest.fn()
    await draw(undefined, { context: 'nowPlaying', extras: { onSleep, onDevices } })

    // The page has the heart, the tags and ⓘ, and the song is already playing.
    expect(screen.queryByRole('button', { name: 'Like' })).toBeNull()
    const order = [
      /^Add to playlist/,
      /^Play similar songs$/,
      /^Download$/,
      /^Sleep timer/,
      /^Devices$/,
      /^Delete from library…$/,
    ]
    const names = itemNames()
    expect(names).toHaveLength(order.length)
    order.forEach((name, at) => expect(names[at]).toMatch(name))
    expect(screen.getByText('This player')).toBeTruthy()
    expect(screen.getByText('Off')).toBeTruthy()

    await fireEvent.press(screen.getByRole('menuitem', { name: /^Sleep timer/ }))
    expect(onSleep).toHaveBeenCalled()
  })

  it('on a computer’s Now Playing, trims the same items and has no player group', async () => {
    // The stage passed nothing, and its ⋯ offered the heart, Tags, Add to Up
    // next and Song details for the song it was already showing and playing.
    await draw(undefined, { context: 'nowPlaying' })

    expect(screen.queryByRole('button', { name: 'Like' })).toBeNull()
    const order = [
      /^Add to playlist/,
      /^Play similar songs$/,
      /^Download$/,
      /^Delete from library…$/,
    ]
    const names = itemNames()
    expect(names).toHaveLength(order.length)
    order.forEach((name, at) => expect(names[at]).toMatch(name))
    expect(screen.queryByText('This player')).toBeNull()
  })

  it('offers nothing of the library for a friend’s song in a room', async () => {
    await draw(undefined, {
      song: { ...SONG, id: -42 },
      context: 'nowPlaying',
      extras: { onSleep: jest.fn(), onDevices: jest.fn() },
    })

    expect(screen.queryByRole('button', { name: 'Like' })).toBeNull()
    expect(itemNames()).toEqual([expect.stringMatching(/^Sleep timer/), 'Devices'])
  })

  it('leaves a room’s song out of the library from a row’s menu too', async () => {
    await draw(undefined, { song: { ...SONG, id: -42 } })

    expect(screen.queryByRole('button', { name: 'Like' })).toBeNull()
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0)
  })

  it('opens Devices from Now Playing’s menu', async () => {
    const onDevices = jest.fn()
    await draw(undefined, {
      context: 'nowPlaying',
      extras: { onSleep: jest.fn(), onDevices },
    })

    await fireEvent.press(screen.getByRole('menuitem', { name: 'Devices' }))
    expect(onDevices).toHaveBeenCalled()
  })

  it('opens the song’s own page from Song details', async () => {
    await draw()

    await fireEvent.press(screen.getByRole('menuitem', { name: 'Song details' }))
    expect(mockNavigate).toHaveBeenCalledWith('/song/4')
  })
})

describe('removing a song where the copy goes with it', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockIndex = downloaded
  })

  it('asks in a dialog of its own, then takes the download and the queued song too', async () => {
    const onClose = jest.fn()
    await draw(onClose)

    await fireEvent.press(screen.getByRole('menuitem', { name: 'Delete from library…' }))
    // The menu goes, and the question is one press in a dialog, not a second
    // state of the menu. It draws through the overlay host a tick later.
    expect(onClose).toHaveBeenCalled()
    expect(await screen.findByText('Delete “Nocturne” from your library?')).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Remove from library' })).toBeNull()

    await fireEvent.press(screen.getByRole('button', { name: 'Delete song' }))
    expect(mockDropDownloads).toHaveBeenCalledWith([4])
    expect(mockForgetSongs).toHaveBeenCalledWith([4])
    expect(mockDeleteSong).toHaveBeenCalledWith({ songIds: [4] }, expect.anything())
  })

  it('still offers dropping the download on its own', async () => {
    await draw()

    await fireEvent.press(screen.getByRole('menuitem', { name: 'Remove from this phone' }))
    expect(mockRemoveByHand).toHaveBeenCalledWith([4])
    expect(mockDeleteSong).not.toHaveBeenCalled()
  })
})
