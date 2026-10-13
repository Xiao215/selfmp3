import { Pressable, Text } from 'react-native'
import { fireEvent, render, screen } from '@testing-library/react-native'

import { useRecentTagIds } from '../library/recentTags.store'
import { useOpenTag } from './useOpenTag'

/**
 * Opening a tag, from any door: every open counts as using it (T-384), so the
 * sidebar's recent tags lead with it. Home's tiles, Now Playing, the song menu,
 * the song's page, Stats and an artist's page had each navigated by hand and
 * left the recent tags without it.
 */

const mockNavigate = jest.fn()
jest.mock('expo-router', () => ({ useRouter: () => ({ navigate: mockNavigate }) }))

const NIGHT = { id: 7, name: 'Night drive' }
const RAIN = { id: 9, name: 'Rain' }

function Doors({ go }: { go?: (href: unknown) => void }): React.ReactNode {
  const open = useOpenTag()
  return (
    <>
      <Pressable onPress={() => open(NIGHT, { from: 'tile' })}>
        <Text>Tile</Text>
      </Pressable>
      <Pressable onPress={() => open(RAIN, { go })}>
        <Text>Chip</Text>
      </Pressable>
      <Text testID="recent">{useRecentTagIds().join(',')}</Text>
    </>
  )
}

describe('useOpenTag', () => {
  beforeEach(() => mockNavigate.mockClear())

  it('counts a tile’s open as a use, and tells the page it came from the tile', async () => {
    await render(<Doors />)
    await fireEvent.press(screen.getByText('Tile'))

    expect(mockNavigate).toHaveBeenCalledWith({
      pathname: '/tag/[name]',
      params: { name: 'Night drive', via: 'tile' },
    })
    expect(screen.getByTestId('recent')).toHaveTextContent(/^7(,|$)/)
  })

  it('goes the caller’s way when it has one, and still counts', async () => {
    const go = jest.fn()
    await render(<Doors go={go} />)
    await fireEvent.press(screen.getByText('Chip'))

    expect(go).toHaveBeenCalledWith({ pathname: '/tag/[name]', params: { name: 'Rain' } })
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(screen.getByTestId('recent')).toHaveTextContent(/^9(,|$)/)
  })
})
