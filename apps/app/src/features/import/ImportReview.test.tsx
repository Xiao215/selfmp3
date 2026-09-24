import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { configureClient, reviewFrom, type Api } from '@selfmp3/client'

import { OverlayProvider } from '../../shell/Overlay'

import { ImportReview } from './ImportReview'
import { patchDraft, resetImportDraft } from './importDraft'

jest.mock('expo-router', () => ({
  Redirect: () => null,
  useRouter: () => ({
    back: () => undefined,
    replace: () => undefined,
    navigate: () => undefined,
    canGoBack: () => true,
  }),
  useNavigation: () => ({ getState: () => undefined }),
}))

// The floating chrome's room reads the player; there is no player here.
jest.mock('../../shell/bottomInset', () => ({ useFootInset: () => 0 }))

jest.mock('./ImportListen', () => ({
  ...jest.requireActual('./ImportListen'),
  useListen: () => ({
    listening: null,
    toggle: () => undefined,
    seek: () => undefined,
    close: () => undefined,
  }),
}))

const mockEnqueue = jest.fn()
/** What the server says the library has now; an answer that does not fit changes nothing. */
const mockAlreadyHave = jest.fn((): Promise<{ have: boolean[] }> => Promise.resolve({ have: [] }))
const JPOP = { id: 7, name: 'jpop', hue: 2, songCount: 0 }
/** The tags of the library the import is going to. */
const mockTags = [JPOP]
/**
 * A tag made while importing is made there too, and turns up in that library's
 * tags — here at once, in the app when the answer is asked for again.
 */
const mockCreateTag = jest.fn((name: string) => {
  const tag = { id: 61, name, hue: 4, songCount: 0 }
  mockTags.push(tag)
  return Promise.resolve(tag)
})
jest.mock('./importSource', () => {
  // One object for the life of the test, as ImportUnreachable.test.tsx says why.
  // Built on the first ask rather than here: the factory runs before the file's
  // own consts, and the tags it holds would be nothing at all.
  let source: unknown = null
  return {
    useImportSource: () => {
      source ??= {
        api: {
          importEnqueue: (request: unknown) => mockEnqueue(request),
          importAlreadyHave: () => mockAlreadyHave(),
        },
        library: { songs: [], tags: mockTags, playlists: [] },
        createTag: (name: string) => mockCreateTag(name),
        tools: { ytdlp: true, ffmpeg: true },
        refetchTools: () => Promise.resolve(),
        queue: { jobs: [], pacing: null },
        invalidateQueue: () => Promise.resolve(),
        invalidateLibrary: () => Promise.resolve(),
      }
      return source
    },
  }
})

/*
 * The tag picker reads this device's library as well as the import's, for the
 * nudge that asks before a tag is named after an artist. Nothing here is that
 * device, so the one client the hooks reach for answers nothing and holds
 * nothing open.
 */
configureClient({
  api: {
    onCloudLibraryChanged: () => () => undefined,
    answersFromCloud: () => true,
    library: () => Promise.resolve({ songs: [], tags: [], playlists: [] }),
  } as unknown as Api,
})

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
}

const item = (n: number, title: string, alreadyHave = false) => ({
  url: `https://open.example/${n}`,
  title,
  artist: 'YOASOBI',
  album: '',
  duration: 240,
  thumbnail: null,
  alreadyHave,
})

const draw = async (): Promise<void> => {
  const client = new QueryClient({
    // The picker reads this device's library too; its collection timer would
    // hold the runner open long after the test had passed.
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  })
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        {/* The tag picker is a sheet, and a sheet is drawn by the shell's overlay host. */}
        <OverlayProvider>
          <ImportReview />
        </OverlayProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  )
}

/**
 * The review on a phone (`P30`): everything starts ticked, a song's box
 * unticks it and ticks it back, the head's box does that for every song, and
 * a tapped row opens to rename the song.
 */
describe('Import review, on a phone', () => {
  beforeEach(() => {
    mockEnqueue.mockReset()
    mockAlreadyHave.mockReset().mockResolvedValue({ have: [] })
    mockCreateTag.mockClear()
    mockTags.length = 1
    patchDraft('own', {
      review: reviewFrom({
        kind: 'playlist',
        playlistTitle: 'THE BOOK',
        items: [item(1, 'アイドル', true), item(2, '群青'), item(3, '怪物')],
      }),
    })
  })
  // The page is still drawn when the draft empties; that is an update like any other.
  afterEach(() => act(() => resetImportDraft()))

  it('counts every song but the one that is yours already', async () => {
    await draw()
    expect(screen.getByText('THE BOOK')).toBeTruthy()
    expect(screen.getByText('Yours already')).toBeTruthy()
    expect(screen.getByTestId('import-count').props['children']).toBe('2 of 3 in')
    expect(screen.getByText('Import 2 songs')).toBeTruthy()
    // A box for each song that can come in, ticked, and the head's over them;
    // none for the song that is yours already.
    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
    expect(screen.getByLabelText('Deselect 群青')).toBeTruthy()
    expect(screen.queryByLabelText(/アイドル$/)).toBeNull()
    expect(screen.getByLabelText('Deselect all')).toBeTruthy()
  })

  it('asks the server again what is yours, since the kept review may be old', async () => {
    // Removed from the library since the link was looked up: coming in after all.
    mockAlreadyHave.mockResolvedValue({ have: [false, false, false] })
    await draw()

    await waitFor(() => expect(screen.queryByText('Yours already')).toBeNull())
    expect(screen.getByTestId('import-count').props['children']).toBe('3 of 3 in')
    expect(screen.getByText('Import 3 songs')).toBeTruthy()
    expect(screen.getByLabelText('Deselect アイドル')).toBeTruthy()
    expect(mockAlreadyHave).toHaveBeenCalledTimes(1)
  })

  it('unticks a song, keeps it listed, and ticks it back', async () => {
    await draw()
    await act(async () => {
      await fireEvent.press(screen.getByLabelText('Deselect 怪物'))
    })
    expect(screen.getByLabelText('Select 怪物')).toBeTruthy()
    expect(screen.getByText('怪物')).toBeTruthy()
    expect(screen.getByTestId('import-count').props['children']).toBe('1 of 3 in')
    expect(screen.getByText('Import 1 song')).toBeTruthy()
    // One unticked: the head's box is neither ticked nor empty.
    expect(screen.getByLabelText('Select all').props['accessibilityState'].checked).toBe('mixed')

    await act(async () => {
      await fireEvent.press(screen.getByLabelText('Select 怪物'))
    })
    expect(screen.getByLabelText('Deselect 怪物')).toBeTruthy()
    expect(screen.getByText('Import 2 songs')).toBeTruthy()
  })

  it('still opens an unticked song, to hear it before deciding', async () => {
    await draw()
    await act(async () => {
      await fireEvent.press(screen.getByLabelText('Deselect 怪物'))
    })
    await act(async () => {
      await fireEvent.press(screen.getByLabelText('怪物, YOASOBI'))
    })
    expect(screen.getByLabelText('Title of track 3')).toBeTruthy()
    // And unticking the open one leaves it open.
    await act(async () => {
      await fireEvent.press(screen.getByLabelText('Deselect 群青'))
    })
    expect(screen.getByLabelText('Title of track 3')).toBeTruthy()
    expect(screen.getByText('Import 0 songs')).toBeTruthy()
  })

  it('unticks every song from the head, and ticks them all back', async () => {
    await draw()
    await act(async () => {
      await fireEvent.press(screen.getByLabelText('Deselect all'))
    })
    expect(screen.getByTestId('import-count').props['children']).toBe('0 of 3 in')
    expect(screen.getByText('Import 0 songs')).toBeTruthy()
    expect(screen.getByLabelText('Select 群青')).toBeTruthy()

    await act(async () => {
      await fireEvent.press(screen.getByLabelText('Select all'))
    })
    expect(screen.getByText('Import 2 songs')).toBeTruthy()
    // Still nothing for the song that is yours already.
    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
  })

  it('keeps its songs when the server is reached at another address', async () => {
    // A cloud library's server is raced at every address it has, and the
    // review is keyed by the server, not by whichever address won this time.
    patchDraft('cloud', {
      review: reviewFrom({ kind: 'playlist', playlistTitle: 'THE BOOK', items: [item(2, '群青')] }),
    })
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const page = (baseUrl: string) => (
      <SafeAreaProvider initialMetrics={METRICS}>
        <QueryClientProvider client={client}>
          <ImportReview via={{ baseUrl, token: 't' }} />
        </QueryClientProvider>
      </SafeAreaProvider>
    )
    const view = await render(page('http://192.168.1.20:4600'))
    await act(async () => {
      await fireEvent.press(screen.getByLabelText('Deselect 群青'))
    })
    await view.rerender(page('http://100.64.0.5:4600'))
    expect(screen.getByText('THE BOOK')).toBeTruthy()
    expect(screen.getByLabelText('Select 群青')).toBeTruthy()
  })

  /*
   * The chips read back the tags the import is going to, and the picker over
   * them has to be the same library's, or a tag ticked there is a number this
   * page knows nothing about: it drew no chip, and the import named a tag the
   * server did not have (Xiao, 2026-09-22).
   */
  it('shows a ticked tag as a chip, and sends it', async () => {
    await draw()
    await act(async () => {
      await fireEvent.press(screen.getByTestId('import-add-tag'))
    })
    await act(async () => {
      await fireEvent.press(screen.getByRole('checkbox', { name: 'jpop' }))
    })
    // The chip is the button; the row in the picker above it is the checkbox.
    expect(screen.getByRole('button', { name: 'jpop' })).toBeTruthy()

    await act(async () => {
      await fireEvent.press(screen.getByTestId('import-commit'))
    })
    expect(mockEnqueue.mock.calls[0][0].tagIds).toEqual([7])
  })

  it('makes a new tag where the import is going, and chips it', async () => {
    await draw()
    await act(async () => {
      await fireEvent.press(screen.getByTestId('import-add-tag'))
    })
    await act(async () => {
      await fireEvent.changeText(screen.getByLabelText('Search or create a tag'), 'citypop')
    })
    await act(async () => {
      await fireEvent.press(screen.getByLabelText('Create citypop'))
    })
    expect(mockCreateTag).toHaveBeenCalledWith('citypop')
    expect(screen.getByRole('button', { name: 'citypop' })).toBeTruthy()
  })

  it('opens a song to rename it, album and all, and sends the new names with no playlist', async () => {
    await draw()
    await act(async () => {
      await fireEvent.press(screen.getByLabelText('群青, YOASOBI'))
    })
    await act(async () => {
      await fireEvent.changeText(screen.getByLabelText('Artist of track 2'), 'YOASOBI feat. 合唱')
    })
    await act(async () => {
      await fireEvent.changeText(screen.getByLabelText('Album of track 2'), 'THE BOOK')
    })

    await act(async () => {
      await fireEvent.press(screen.getByTestId('import-commit'))
    })
    expect(mockEnqueue).toHaveBeenCalledTimes(1)
    const request = mockEnqueue.mock.calls[0][0]
    expect(request.items.map((song: { title: string }) => song.title)).toEqual(['群青', '怪物'])
    expect(request.items[0].artist).toBe('YOASOBI feat. 合唱')
    expect(request.items[0].album).toBe('THE BOOK')
    expect(request.playlistId).toBeNull()
    expect(request.createPlaylistName).toBeNull()
  })
})
