import { act, fireEvent, screen } from '@testing-library/react-native'
import type { TidyResult } from '@selfmp3/shared'

import { currentToasts, dismissToast } from '../../ui/toast'
import { TidyReview } from './TidyReview'
import { drawReview, fakeLibrary, pressToast, songOf } from './smartUndo.fixture'

/**
 * What a fill adds, Undo takes away (docs/features/ai.md, "Filling in what's
 * missing"): the album and year as the ordinary edit, and the cover — taken in
 * by the library's computer — taken off again there, since a fill only fills
 * a cover that was missing. Only the network is faked.
 */

jest.mock('../../shell/useLayout', () => {
  const layout = { wide: false, dense: false, compact: true, finePointer: false, width: 390 }
  return {
    useLayout: () => layout,
    useLayoutValue: (select: (value: typeof layout) => unknown) => select(layout),
    useWindowValue: (select: (value: object) => unknown) =>
      select({ width: 390, height: 844, scale: 3, fontScale: 1 }),
  }
})

// A device talking to its library's computer, not a cloud library.
jest.mock('../../connection/ConnectionProvider', () => ({
  useConnection: () => ({ connection: null, fromCloud: false, status: 'ready' }),
}))

// The library's computer is this device's server: its ids are this device's.
jest.mock('./useSmartServer', () => ({
  useSmartServer: () => ({
    api: jest.requireActual<typeof import('@selfmp3/client')>('@selfmp3/client').clientApi(),
    onDevice: (id: number) => id,
    onServer: (id: number) => id,
  }),
}))

const ARTWORK = 'https://is1-ssl.mzstatic.com/image/thumb/yoru/600x600bb.jpg'

const FILL: TidyResult = {
  changes: [
    {
      key: 'album-1',
      field: 'album',
      from: '',
      to: 'THE BOOK',
      why: 'From iTunes',
      by: 'rule',
      songIds: [1],
    },
    {
      key: 'year-1',
      field: 'year',
      from: '',
      to: '2019',
      why: 'From iTunes',
      by: 'rule',
      songIds: [1],
    },
    {
      key: 'cover-1',
      field: 'cover',
      from: '',
      to: ARTWORK,
      why: 'From iTunes',
      by: 'rule',
      songIds: [1],
    },
  ],
  looked: 1,
  note: null,
  asked: 'Fill in what’s missing',
  reply: null,
  gaps: null,
}

/** Lets the requests a press sent, and what follows each, all finish. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 10; turn++) await new Promise(done => setTimeout(done, 0))
}

afterEach(() => {
  for (const toast of currentToasts()) dismissToast(toast.id)
})

it('takes the filled-in cover off again on Undo, with the album and year', async () => {
  const net = fakeLibrary([songOf(1, '夜に駆ける')])
  await drawReview(<TidyReview result={FILL} height={600} />)

  const apply = await screen.findByTestId('tidy-apply')
  await act(async () => {
    await fireEvent.press(apply)
    await settle()
  })
  expect(currentToasts().at(-1)?.text).toBe('Fixed 1 song')
  expect(net.sent).toEqual([
    {
      at: 'POST /api/songs/bulk/edit',
      body: { edits: [{ songId: 1, patch: { album: 'THE BOOK', year: 2019 } }] },
    },
    { at: 'POST /api/songs/1/apply-metadata', body: { artworkUrl: ARTWORK } },
  ])
  expect(net.songs[0]).toMatchObject({ album: 'THE BOOK', year: 2019, hasArt: true })

  await act(async () => {
    pressToast('Undo')
    await settle()
  })
  expect(currentToasts().at(-1)?.text).toBe('Put back 1 song')

  // Exactly as before the fill: no album, no year, no cover.
  expect(net.sent.slice(2)).toEqual([
    { at: 'DELETE /api/songs/1/cover', body: undefined },
    {
      at: 'POST /api/songs/bulk/edit',
      body: { edits: [{ songId: 1, patch: { album: '', year: null } }] },
    },
  ])
  expect(net.songs[0]).toMatchObject({ album: '', year: null, hasArt: false })
})

it('draws a change on one song with that song’s cover, as an opened change draws each', async () => {
  fakeLibrary([
    songOf(1, '盗作', { artist: 'Yorushika', album: 'Spell' }),
    songOf(2, '又三郎', { artist: 'Yorushika', album: 'Wanderer' }),
    songOf(3, '修羅', { artist: 'Yorushika', album: 'Wanderer' }),
  ])
  const rename = (key: string, songIds: number[]): TidyResult['changes'][number] => ({
    key,
    field: 'artist',
    from: 'Yorushika',
    to: 'ヨルシカ',
    why: 'The name on 网易云',
    by: 'rule',
    songIds,
  })
  await drawReview(
    <TidyReview
      result={{ ...FILL, changes: [rename('one', [1]), rename('two', [2, 3])] }}
      height={600}
    />,
  )

  await screen.findAllByTestId('tidy-change')
  // The letter tile of the one song's album; the two songs' stay folded away.
  expect(screen.getByText('S')).toBeTruthy()
  expect(screen.queryByText('W')).toBeNull()
})

it('as Ask’s card, shows a long review’s first few, puts the model’s words first, and says what Fix did', async () => {
  fakeLibrary([1, 2, 3, 4, 5, 6, 7].map(id => songOf(id, `Song ${id}`)))
  const title = (id: number): TidyResult['changes'][number] => ({
    key: `title-${id}`,
    field: 'title',
    from: `Song ${id}`,
    to: `歌 ${id}`,
    why: 'The name on 网易云',
    by: 'rule',
    songIds: [id],
  })
  const closed: (string | undefined)[] = []
  await drawReview(
    <TidyReview
      card
      result={{
        ...FILL,
        changes: [1, 2, 3, 4, 5, 6, 7].map(title),
        looked: 7,
        reply: 'I used the names 网易云 lists.',
        note: '2 songs were looked up on the web.',
      }}
      height={600}
      onClose={outcome => closed.push(outcome)}
    />,
  )

  // Three of seven in the card, the rest one press away.
  expect(await screen.findAllByTestId('tidy-change')).toHaveLength(3)
  expect(screen.getByTestId('tidy-all')).toBeTruthy()
  // The model's words are the answer, not small print among the review's notes.
  expect(screen.getByTestId('tidy-reply')).toBeTruthy()

  await act(async () => {
    await fireEvent.press(screen.getAllByTestId('tidy-apply')[0]!)
    await settle()
  })
  expect(closed).toEqual(['Fixed 7 songs'])
})
