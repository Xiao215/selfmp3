import { fireEvent, render, screen } from '@testing-library/react-native'

import { PlayPauseButton } from './PlayPauseButton'

/**
 * The one play button (T-380, T-416). It reads the stall itself, so every
 * place that draws it says it is waiting on the network: Now Playing's two
 * views on a phone, Up next's card and a room's did not, and showed a pause
 * glyph over silence.
 */

const mockToggle = jest.fn()
let mockState = { playing: true, stalled: false, loaded: 4 as number | null }
jest.mock('../../player/PlayerProvider', () => ({
  usePlayerCommands: () => ({ toggle: mockToggle }),
  usePlayerPlaying: () => mockState.playing,
  usePlayerStalled: () => mockState.stalled,
  usePlayingSongId: () => mockState.loaded,
}))
jest.mock('../../shell/useLayout', () => {
  const layout = { wide: false, dense: false, compact: true, finePointer: false, width: 390 }
  return { useLayoutValue: (select: (value: typeof layout) => unknown) => select(layout) }
})

describe('PlayPauseButton', () => {
  beforeEach(() => jest.clearAllMocks())

  it('says it is waiting while the player is stalled', async () => {
    mockState = { playing: true, stalled: true, loaded: 4 }
    await render(<PlayPauseButton />)

    const button = screen.getByRole('button', { name: 'Pause' })
    expect(button).toBeBusy()
  })

  it('plays and pauses the player when nothing else is asked of it', async () => {
    mockState = { playing: false, stalled: false, loaded: 4 }
    await render(<PlayPauseButton />)

    const button = screen.getByRole('button', { name: 'Play' })
    expect(button).not.toBeBusy()
    await fireEvent.press(button)
    expect(mockToggle).toHaveBeenCalled()
  })

  it('on a song’s own page, is Play for a song that is not the one loaded, and never waits for it', async () => {
    mockState = { playing: true, stalled: true, loaded: 9 }
    const onPress = jest.fn()
    await render(<PlayPauseButton songId={4} playLabel="Play Nocturne" onPress={onPress} />)

    const button = screen.getByRole('button', { name: 'Play Nocturne' })
    expect(button).not.toBeBusy()
    await fireEvent.press(button)
    expect(onPress).toHaveBeenCalled()
    expect(mockToggle).not.toHaveBeenCalled()
  })

  it('shows someone else’s play state when given one: a friend’s room', async () => {
    mockState = { playing: false, stalled: false, loaded: null }
    await render(<PlayPauseButton playing />)

    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy()
  })
})
