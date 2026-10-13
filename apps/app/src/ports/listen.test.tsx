import { AppState, type AppStateStatus } from 'react-native'
import { createListenAudio } from './listen'
import type { ListenState } from './listen.types'

/**
 * expo-audio's players, as its AudioModule treats them: one playing as the
 * app leaves is paused, and played again as the app comes back
 * (`shouldPlayInBackground` false) — unless it has been removed.
 */
interface FakePlayer {
  playing: boolean
  removed: boolean
  currentTime: number
  wasPlaying: boolean
  seekedTo: number | null
  readonly currentStatus: { playbackState: string }
  addListener(): { remove(): void }
  play(): void
  pause(): void
  seekTo(seconds: number): Promise<void>
  remove(): void
}
const mockPlayers: FakePlayer[] = []
jest.mock('expo-audio', () => ({
  setAudioModeAsync: () => Promise.resolve(),
  preload: () => Promise.resolve(),
  clearPreloadedSource: () => Promise.resolve(),
  createAudioPlayer: () => {
    const player: FakePlayer = {
      playing: false,
      removed: false,
      currentTime: 0,
      wasPlaying: false,
      seekedTo: null,
      currentStatus: { playbackState: 'readyToPlay' },
      addListener: () => ({ remove() {} }),
      play() {
        this.playing = true
      },
      pause() {
        this.playing = false
      },
      seekTo(seconds: number) {
        this.seekedTo = seconds
        this.currentTime = seconds
        return Promise.resolve()
      },
      remove() {
        this.removed = true
        this.playing = false
      },
    }
    mockPlayers.push(player)
    return player
  },
}))

/** The app going to the background and back, with expo-audio's own pause and play either side. */
function appState(): { leave(): void; comeBack(): void } {
  const handlers: ((state: AppStateStatus) => void)[] = []
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    handlers.push(handler as (state: AppStateStatus) => void)
    return { remove: () => undefined } as ReturnType<typeof AppState.addEventListener>
  })
  return {
    leave: () => {
      for (const player of mockPlayers.filter(each => !each.removed && each.playing)) {
        player.wasPlaying = true
        player.pause()
      }
      for (const handler of handlers) handler('background')
    },
    comeBack: () => {
      for (const player of mockPlayers.filter(each => !each.removed && each.wasPlaying)) {
        player.wasPlaying = false
        player.play()
      }
      for (const handler of handlers) handler('active')
    },
  }
}

const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

describe('a preview on a phone, when the app goes to the background', () => {
  beforeEach(() => {
    mockPlayers.splice(0)
    jest.restoreAllMocks()
  })

  it('stays stopped when the app comes back, as the card says, and plays on from where it was', async () => {
    const app = appState()
    const audio = createListenAudio()!
    const told: ListenState[] = []
    audio.subscribe(state => told.push(state))

    audio.play('https://server.test/api/import/listen?url=a')
    await settle()
    const first = mockPlayers[0]!
    expect(first.playing).toBe(true)
    first.currentTime = 84

    app.leave()
    app.comeBack()
    // Nothing plays behind a card that says it is paused.
    expect(mockPlayers.some(player => player.playing)).toBe(false)
    expect(told.at(-1)).toMatchObject({ status: 'paused', currentTime: 84 })

    audio.resume()
    await settle()
    const again = mockPlayers.at(-1)!
    expect(again).not.toBe(first)
    expect(again.seekedTo).toBe(84)
    expect(again.playing).toBe(true)
    audio.dispose()
  })

  it('leaves a preview paused by hand as it was', async () => {
    const app = appState()
    const audio = createListenAudio()!
    audio.play('https://server.test/api/import/listen?url=a')
    await settle()
    audio.pause()
    app.leave()
    app.comeBack()
    expect(mockPlayers[0]?.removed).toBe(false)
    expect(mockPlayers[0]?.playing).toBe(false)
    audio.dispose()
  })
})
