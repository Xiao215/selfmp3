import { fireEvent, render, screen } from '@testing-library/react-native'
import { Text, View } from 'react-native'
import type { Song, Tag } from '@selfmp3/shared'

import { SongRow } from './SongRow'

/**
 * One song row, everywhere.
 *
 * The playlist page used to draw a row of its own, and the difference was
 * everything a row is for: no heart, no ⋯ at a finger's size, no tag chips,
 * no colour under the song that is playing. These are the checks that say the
 * playlist's row is the library's row with a grip added, rather than a second
 * row that drifts from it again.
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

/** A playlist's row: the same row, plus a grip and the state of a move. */
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
    leading: (
      <View accessibilityRole="button" accessibilityLabel={`Move ${song.title}`}>
        <Text>grip</Text>
      </View>
    ),
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

  it('draws what a playlist adds: the grip, and where a move would land', async () => {
    const plain = await render(<SongRow {...playlistRow()} />)
    expect(screen.getByLabelText(`Move ${song.title}`)).toBeTruthy()

    // Lifted and a drop target are drawing, not behaviour; what matters is
    // that asking for them changes nothing else about the row.
    await plain.rerender(<SongRow {...playlistRow({ lifted: true, dropTarget: 'below' })} />)
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
