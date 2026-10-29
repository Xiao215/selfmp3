import { Text } from 'react-native'
import { fireEvent, render, screen } from '@testing-library/react-native'
import type { Song } from '@selfmp3/shared'

import { lightTap } from '../../ports/haptics'
import { useRecentTagIds } from '../library/recentTags.store'
import { SongTagsLine } from './SongTagsLine'

/**
 * The song's tags on Now Playing, which the phone's page and the computer's
 * stage both draw: a room's song says whose it is instead, and opening a tag
 * counts as using it.
 *
 * The stage had no room guard (T-376): for a friend's song it offered "Edit
 * tags" on a song you do not have.
 */

jest.mock('@selfmp3/client', () => ({
  ...jest.requireActual('@selfmp3/client'),
  useLibrary: () => ({
    data: {
      tags: [
        { id: 7, name: 'Night drive', hue: 210 },
        { id: 8, name: 'Calm', hue: 160 },
      ],
    },
  }),
}))
// A tag added in sight taps the phone; one the song came up with does not.
jest.mock('../../ports/haptics', () => ({ lightTap: jest.fn(), firmTap: jest.fn() }))
// Who brought a room's song reads the room and the server; here it only has to be the one drawn.
jest.mock('../room/RoomSongLine', () => {
  const { Text: RoomText } = jest.requireActual<typeof import('react-native')>('react-native')
  return { RoomSongLine: () => <RoomText>Brought by a friend</RoomText> }
})

const SONG = {
  id: 4,
  title: 'Nocturne',
  artist: 'Klara Feld',
  tagIds: [7],
} as unknown as Song

function Recent(): React.ReactNode {
  return <Text testID="recent">{useRecentTagIds().join(',')}</Text>
}

describe('SongTagsLine', () => {
  it('opens a tag, and counts that as using it', async () => {
    const onOpen = jest.fn()
    await render(
      <>
        <SongTagsLine song={SONG} onOpen={onOpen} onEdit={() => undefined} />
        <Recent />
      </>,
    )

    await fireEvent.press(screen.getByText('Night drive'))
    expect(onOpen).toHaveBeenCalledWith({
      pathname: '/tag/[name]',
      params: { name: 'Night drive' },
    })
    expect(screen.getByTestId('recent')).toHaveTextContent('7')
  })

  it('names the add chip by what it does, and opens the tag window', async () => {
    const onEdit = jest.fn()
    await render(<SongTagsLine song={SONG} onOpen={() => undefined} onEdit={onEdit} labelled />)

    await fireEvent.press(screen.getByRole('button', { name: 'Edit tags' }))
    expect(onEdit).toHaveBeenCalled()
    expect(screen.getByText('Edit tags')).toBeTruthy()
  })

  it('says who brought a room’s song, with no tags to edit', async () => {
    await render(
      <SongTagsLine
        song={{ ...SONG, id: -42 }}
        onOpen={() => undefined}
        onEdit={() => undefined}
        labelled
      />,
    )

    expect(screen.getByText('Brought by a friend')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /tags/ })).toBeNull()
    expect(screen.queryByText('Night drive')).toBeNull()
  })

  it('snaps in only a tag added while it is in sight', async () => {
    jest.mocked(lightTap).mockClear()
    const view = await render(
      <SongTagsLine song={SONG} onOpen={() => undefined} onEdit={() => undefined} />,
    )
    expect(lightTap).not.toHaveBeenCalled()

    await view.rerender(
      <SongTagsLine
        song={{ ...SONG, tagIds: [7, 8] }}
        onOpen={() => undefined}
        onEdit={() => undefined}
      />,
    )
    expect(screen.getByText('Calm')).toBeTruthy()
    expect(lightTap).toHaveBeenCalledTimes(1)

    // Another song comes up with its tags: they are its own, and stand still.
    await view.rerender(
      <SongTagsLine
        song={{ ...SONG, id: 5, tagIds: [7, 8] }}
        onOpen={() => undefined}
        onEdit={() => undefined}
      />,
    )
    expect(lightTap).toHaveBeenCalledTimes(1)
  })
})
