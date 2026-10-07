import { render, screen } from '@testing-library/react-native'
import { EMPTY_QUEUE, type AskAnswer } from '@selfmp3/shared'

import { PlaybackAnswer } from './PlaybackAnswer'

/**
 * Ask's playback answer, carried out on this device: told to the player once,
 * however often the answer is drawn, and said in a line.
 */

const mockCommands = {
  next: jest.fn(),
  seekTo: jest.fn(),
  toggle: jest.fn(),
  jumpTo: jest.fn(),
}
const mockQueue = { ...EMPTY_QUEUE, items: [10, 11, 12, 13], index: 1 }
jest.mock('../../player/PlayerProvider', () => ({
  usePlayer: () => ({ queue: mockQueue, isPlaying: true }),
  usePlayerCommands: () => mockCommands,
}))
const mockSongs = new Map([
  [12, { id: 12, title: 'Gunjou' }],
  [13, { id: 13, title: 'Idol' }],
])
jest.mock('../../ui/songsById', () => ({ useSongsById: () => mockSongs }))

type Playback = Extract<AskAnswer, { kind: 'playback' }>

beforeEach(() => {
  for (const command of Object.values(mockCommands)) command.mockClear()
})

it('plays the song meant in Up next, and says which', async () => {
  const answer: Playback = { kind: 'playback', op: 'upNext', place: -1 }
  await render(<PlaybackAnswer answer={answer} />)
  expect(mockCommands.jumpTo).toHaveBeenCalledWith(3)
  expect(screen.getByTestId('ask-playback-said')).toHaveTextContent(
    'Playing “Idol”, the last in Up next.',
  )
})

it('does it once, though the same answer is drawn again', async () => {
  const answer: Playback = { kind: 'playback', op: 'next', place: null }
  const first = await render(<PlaybackAnswer answer={answer} />)
  await first.unmount()
  await render(<PlaybackAnswer answer={answer} />)
  expect(mockCommands.next).toHaveBeenCalledTimes(1)
  expect(screen.getByTestId('ask-playback-said')).toHaveTextContent('Skipped to the next song.')
})

it('tells the player nothing when there is nothing to do', async () => {
  await render(<PlaybackAnswer answer={{ kind: 'playback', op: 'resume', place: null }} />)
  for (const command of Object.values(mockCommands)) expect(command).not.toHaveBeenCalled()
  expect(screen.getByTestId('ask-playback-said')).toHaveTextContent('Already playing.')
})
