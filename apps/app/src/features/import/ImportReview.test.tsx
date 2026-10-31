import type { ReactElement } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { configureClient, reviewFrom, type Api } from '@selfmp3/client'

import { OverlayProvider } from '../../shell/Overlay'

import { ImportReview } from './ImportReview'
import { draftFor, patchDraft, resetImportDraft } from './importDraft'

/** Whether the review is the page on top; a page pushed over it leaves it drawn underneath. */
const mockFocused = { current: true }
jest.mock('expo-router', () => ({
  Redirect: () => null,
  useRouter: () => ({
    back: () => undefined,
    replace: () => undefined,
    navigate: () => undefined,
    canGoBack: () => true,
  }),
  useNavigation: () => ({ getState: () => undefined }),
  usePathname: () => '/',
  // As the stack's: the effect runs while the page is on top, and its cleanup once it is not.
  useFocusEffect: (effect: () => undefined | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react')
    const focused = mockFocused.current
    useEffect(() => (focused ? effect() : undefined), [focused, effect])
  },
}))

// The floating chrome's room reads the player; there is no player here.
jest.mock('../../shell/bottomInset', () => ({
  useFootInset: () => 0,
  useFloatingChrome: () => 0,
}))

const mockClose = jest.fn()
// One set of handlers for every render, as the real hook's keep their identity.
const mockListen = {
  listening: null,
  toggle: () => undefined,
  seek: () => undefined,
  close: (options?: { resume?: boolean }) => mockClose(options),
}
jest.mock('./ImportListen', () => ({
  ...jest.requireActual('./ImportListen'),
  useListen: () => mockListen,
}))

const mockEnqueue = jest.fn()
/** The model's names for the rows that look wrong (A9): none, unless a test says. */
const mockImportNames = jest.fn((_request: unknown): Promise<{ suggestions: unknown[] }> =>
  Promise.resolve({ suggestions: [] }),
)
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
          importNames: (request: unknown) => mockImportNames(request),
        },
        // Look-ups go to the same server, given longer to answer.
        get lookUp() {
          return (this as { api: unknown }).api
        },
        library: { songs: [], tags: mockTags, playlists: [] },
        createTag: (name: string) => mockCreateTag(name),
        tools: { ytdlp: true, ffmpeg: true },
        refetchTools: () => Promise.resolve(),
        queue: { jobs: [], done: 0, pacing: null },
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
    library: () =>
      Promise.resolve({
        songs: [],
        tags: [],
        playlists: [],
        artistNames: {},
        artistNamesFound: [],
      }),
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
  waitingToUpload: false,
  inQueue: false,
  source: 'youtube' as const,
  netease: null,
  youtube: null,
})

/** Draws the review, and gives back a way to draw it again (after `mockFocused` changes). */
const draw = async (): Promise<() => unknown> => {
  const client = new QueryClient({
    // The picker reads this device's library too; its collection timer would
    // hold the runner open long after the test had passed.
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  })
  // A new element each time, or React keeps the drawn one as it is.
  const page = (): ReactElement => (
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        {/* The tag picker is a sheet, and a sheet is drawn by the shell's overlay host. */}
        <OverlayProvider>
          <ImportReview />
        </OverlayProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  )
  const view = await render(page())
  return () => view.rerender(page())
}

/**
 * The review on a phone (`P30`): everything starts ticked, a song's box
 * unticks it and ticks it back, the head's box does that for every song, and
 * a tapped row opens to rename the song.
 */
describe('Import review, on a phone', () => {
  beforeEach(() => {
    // What the server answers an enqueue with, so what reads the answer has one.
    mockEnqueue
      .mockReset()
      .mockResolvedValue({ jobs: [], skipped: 0, playlistId: null, device: null, leases: [] })
    mockAlreadyHave.mockReset().mockResolvedValue({ have: [] })
    mockCreateTag.mockClear()
    mockClose.mockClear()
    mockFocused.current = true
    mockTags.length = 1
    patchDraft('own', {
      review: reviewFrom({
        unread: [],
        from: 'youtube',
        kind: 'playlist',
        playlistTitle: 'THE BOOK',
        items: [item(1, 'アイドル', true), item(2, '群青'), item(3, '怪物')],
      }),
    })
  })
  // The page is still drawn when the draft empties; that is an update like any other.
  afterEach(() => act(() => resetImportDraft()))

  it('offers the model’s names under a row whose names look wrong, and takes them on Use', async () => {
    mockImportNames.mockResolvedValueOnce({
      suggestions: [
        { row: 0, title: '群青', artist: 'YOASOBI', album: 'THE BOOK', why: 'Album from the list' },
      ],
    })
    await draw()
    // Only the songs coming in are asked about, with the list's name.
    expect(mockImportNames).toHaveBeenCalledWith({
      list: 'THE BOOK',
      rows: [
        { title: '群青', artist: 'YOASOBI', album: '', duration: 240 },
        { title: '怪物', artist: 'YOASOBI', album: '', duration: 240 },
      ],
    })
    // The row that said so: the second in the list, the first asked about.
    expect(await screen.findByTestId('import-suggestion-1')).toBeTruthy()
    expect(screen.getByText('Album from the list')).toBeTruthy()
    // Only the name it changes, the album: the title and artist it keeps are left out.
    expect(within(screen.getByTestId('import-suggestion-1')).getByText('THE BOOK')).toBeTruthy()
    expect(screen.getByLabelText('Use the suggested album THE BOOK')).toBeTruthy()
    await act(async () => {
      await fireEvent.press(screen.getByTestId('import-suggestion-use-1'))
    })
    expect(draftFor('own').review?.items[1]).toMatchObject({ title: '群青', album: 'THE BOOK' })
    // Taken: the row's names are no longer the ones the model read.
    expect(screen.queryByTestId('import-suggestion-1')).toBeNull()
  })

  it('counts every song but the one that is yours already', async () => {
    await draw()
    expect(screen.getByText('THE BOOK')).toBeTruthy()
    expect(screen.getByText('In library')).toBeTruthy()
    expect(screen.getByTestId('import-count').props['children']).toBe('2 of 3 in')
    expect(screen.getByText('Import 2 songs')).toBeTruthy()
    // A box for each song that can come in, ticked, and the head's over them;
    // none for the song that is yours already.
    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
    expect(screen.getByLabelText('Deselect 群青')).toBeTruthy()
    expect(screen.queryByLabelText(/アイドル$/)).toBeNull()
    expect(screen.getByLabelText('Deselect all')).toBeTruthy()
  })

  it('says over the songs which pasted links it could not read, and why', async () => {
    const review = draftFor('own').review!
    patchDraft('own', {
      review: {
        ...review,
        unread: [
          { url: 'https://youtu.be/zzzzzzzzzzz', why: 'This video isn’t on YouTube any more.' },
        ],
      },
    })
    await draw()
    expect(screen.getByText('Couldn’t read 1 link')).toBeTruthy()
    expect(
      within(screen.getByTestId('import-unread')).getByText(/isn’t on YouTube any more/),
    ).toBeTruthy()
    // The songs of the links it read are still there to import.
    expect(screen.getByText('Import 2 songs')).toBeTruthy()
  })

  it('asks the server again what is yours, since the kept review may be old', async () => {
    // Removed from the library since the link was looked up: coming in after all.
    mockAlreadyHave.mockResolvedValue({ have: [false, false, false] })
    await draw()

    await waitFor(() => expect(screen.queryByText('In library')).toBeNull())
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

  it('ticks the open song from its card, liked while hearing it', async () => {
    await draw()
    await act(async () => {
      await fireEvent.press(screen.getByLabelText('Deselect 怪物'))
    })
    await act(async () => {
      await fireEvent.press(screen.getByLabelText('怪物, YOASOBI'))
    })
    expect(screen.getByLabelText('Title of track 3')).toBeTruthy()
    await act(async () => {
      await fireEvent.press(screen.getByLabelText('Select 怪物'))
    })
    expect(screen.getByLabelText('Deselect 怪物')).toBeTruthy()
    expect(screen.getByLabelText('Title of track 3')).toBeTruthy()
    expect(screen.getByText('Import 2 songs')).toBeTruthy()
  })

  it('stops the preview and puts the card away when another page goes over it', async () => {
    const redraw = await draw()
    await act(async () => {
      await fireEvent.press(screen.getByLabelText('怪物, YOASOBI'))
    })
    expect(screen.getByLabelText('Title of track 3')).toBeTruthy()
    expect(mockClose).not.toHaveBeenCalled()
    mockFocused.current = false
    await act(async () => {
      await redraw()
    })
    await waitFor(() => expect(mockClose).toHaveBeenCalledWith({ resume: false }))
    expect(screen.queryByLabelText('Title of track 3')).toBeNull()
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
      review: reviewFrom({
        unread: [],
        from: 'youtube',
        kind: 'playlist',
        playlistTitle: 'THE BOOK',
        items: [item(2, '群青')],
      }),
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
  it('shows a ticked tag as a chip, sends it, and lets it go once the songs are queued', async () => {
    await draw()
    await act(async () => {
      await fireEvent.press(screen.getByTestId('import-add-tag'))
    })
    await act(async () => {
      await fireEvent.press(screen.getByRole('checkbox', { name: 'jpop' }))
    })
    // The chip is the button; the row in the picker above it is the checkbox.
    // The chip is on the page under the open picker, which hides the page
    // from a screen reader while it is up.
    expect(screen.getByRole('button', { name: 'jpop', includeHiddenElements: true })).toBeTruthy()

    // Import, on the page under the picker (which a press on it straight
    // after opening would not put away, `BACKDROP_SETTLE_MS`).
    await act(async () => {
      await fireEvent.press(screen.getByTestId('import-commit', { includeHiddenElements: true }))
    })
    expect(mockEnqueue.mock.calls[0][0].tagIds).toEqual([7])
    // The tags were for these songs: the next link starts with none.
    await waitFor(() => expect(draftFor('own').review).toBeNull())
    expect([...draftFor('own').tagIds]).toEqual([])
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
    // On the page, under the picker that hides it from a screen reader.
    expect(
      screen.getByRole('button', { name: 'citypop', includeHiddenElements: true }),
    ).toBeTruthy()
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
