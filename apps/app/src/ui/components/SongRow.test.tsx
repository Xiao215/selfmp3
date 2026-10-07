import { act, fireEvent, render, screen } from '@testing-library/react-native'
import type { Song, Tag } from '@selfmp3/shared'

import { setRootWidth } from '../../shell/rootWidth'
import { AccentProvider, useAccent } from '../accent'
import { SongRow } from './SongRow'

/*
 * A row's renders, counted where it asks for its colour: `SongRow` calls
 * `useSongColor` once a render, whichever width it is drawn at.
 */
let mockRowRenders = 0
jest.mock('../useSongColor', () => {
  const actual = jest.requireActual<typeof import('../useSongColor')>('../useSongColor')
  return {
    ...actual,
    useSongColor: (...args: Parameters<typeof actual.useSongColor>) => {
      mockRowRenders += 1
      return actual.useSongColor(...args)
    },
  }
})

/**
 * One song row, everywhere.
 *
 * The playlist page used to draw a row of its own, and the difference was
 * everything a row is for: no heart, no ⋯ at a finger's size, no tag chips,
 * no colour under the song that is playing. These are the checks that say the
 * playlist's row is the library's row, rather than a second row that drifts
 * from it again.
 *
 * Rendered at the default test window, which is narrower than the 820-point
 * breakpoint — so this is the phone's shape, which is where the owner found
 * the difference.
 */

const song: Song = {
  id: 7,
  path: 'YOASOBI/idol.m4a',
  title: 'アイドル',
  artist: 'YOASOBI',
  album: 'THE BOOK',
  albumArtist: '',
  trackNo: null,
  year: 2023,
  duration: 213,
  sizeBytes: 1024,
  mime: 'audio/mp4',
  hasArt: false,
  rev: 'r1',
  coverTone: null,
  lyricsKind: 'none',
  instrumental: false,
  playCount: 0,
  skipCount: 0,
  loved: false,
  sourceUrl: null,
  lastPlayedAt: null,
  addedAt: '2026-01-01T00:00:00.000Z',
  tagIds: [1],
  audioFeatures: null,
}

const tags: readonly Tag[] = [{ id: 1, name: 'chill', hue: 150, songCount: 3 }]

/** A playlist's row: the same row, and the state of a move. */
function playlistRow(
  extra: Partial<Parameters<typeof SongRow>[0]> = {},
): Parameters<typeof SongRow>[0] {
  return {
    song,
    artUri: null,
    downloaded: false,
    index: 0,
    tags,
    onPress: jest.fn(),
    onMore: jest.fn(),
    onToggleSelect: jest.fn(),
    onToggleTag: jest.fn(),
    onEditTags: jest.fn(),
    ...extra,
  }
}

describe('a playlist row is a library row', () => {
  it('has the ⋯ and the length a library row has, and no heart', async () => {
    await render(<SongRow {...playlistRow()} />)

    expect(screen.getByLabelText(`More actions for ${song.title}`)).toBeTruthy()
    expect(screen.getByText(/3:33/)).toBeTruthy()
    // Loving a song is in its menu and on its page (`S3`), not on every row.
    expect(screen.queryByLabelText(`Love ${song.title}`)).toBeNull()
  })

  it('draws what a playlist adds: the lifted look', async () => {
    const plain = await render(<SongRow {...playlistRow()} />)

    // Lifted is drawing, not behaviour; what matters is that asking for it
    // changes nothing else about the row.
    await plain.rerender(<SongRow {...playlistRow({ lifted: true })} />)
    expect(screen.getByLabelText(`More actions for ${song.title}`)).toBeTruthy()
  })

  it('leaves the hold to the move when the page says the move owns it', async () => {
    const onMore = jest.fn()
    await render(<SongRow {...playlistRow({ onMore, onLongPress: null })} />)

    await fireEvent(screen.getByLabelText(`${song.title}, ${song.artist}`), 'longPress')
    expect(onMore).not.toHaveBeenCalled()
  })

  it('still opens the menu on a hold where nothing else claims it', async () => {
    const onMore = jest.fn()
    await render(<SongRow {...playlistRow({ onMore, onLongPress: undefined })} />)

    await fireEvent(screen.getByLabelText(`${song.title}, ${song.artist}`), 'longPress')
    expect(onMore).toHaveBeenCalled()
  })

  it('selects on a hold where a page asks for that, as the library does', async () => {
    const onLongPress = jest.fn()
    await render(<SongRow {...playlistRow({ onLongPress })} />)

    await fireEvent(screen.getByLabelText(`${song.title}, ${song.artist}`), 'longPress')
    expect(onLongPress).toHaveBeenCalledWith(song)
  })
})

describe('a row that is not playing', () => {
  /*
   * Every row asks for its playing colour, and the accent is part of that
   * colour. A row that read the accent's context re-rendered on every frame of
   * a drag on the accent picker — the whole list of them, for the one row
   * that is playing. This counts the renders of one row that is not.
   */
  it('does not re-render when the accent changes', async () => {
    jest.useFakeTimers()
    const picker: { accent?: ReturnType<typeof useAccent> } = {}
    function Picker(): null {
      picker.accent = useAccent()
      return null
    }
    await render(
      <AccentProvider>
        <Picker />
        <SongRow {...playlistRow()} />
      </AccentProvider>,
    )
    const drawn = mockRowRenders

    for (const hue of [20, 60, 150, 220]) {
      await act(async () => {
        picker.accent?.setHue(hue)
        // The picker lands a hue once a frame.
        jest.advanceTimersByTime(20)
      })
    }

    // The accent did move, and the row heard none of it.
    expect(picker.accent?.hue).toBe(220)
    expect(mockRowRenders).toBe(drawn)
    jest.useRealTimers()
  })

  /*
   * A row asked the layout for its width, so dragging a window's edge rendered
   * every row on screen once a pixel. It asks whether the window is wide, and
   * renders when that answer changes.
   */
  it('does not re-render while a window is resized within its width class', async () => {
    await act(async () => setRootWidth(390))
    await render(<SongRow {...playlistRow()} />)
    const drawn = mockRowRenders

    for (const width of [400, 480, 600, 700]) {
      await act(async () => setRootWidth(width))
    }
    expect(mockRowRenders).toBe(drawn)

    // Across the breakpoint it is a different row, and it says so.
    await act(async () => setRootWidth(1200))
    expect(mockRowRenders).toBeGreaterThan(drawn)
  })
})
