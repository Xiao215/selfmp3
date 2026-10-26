import { EMPTY_QUEUE, type QueueState } from '@selfmp3/shared'

import type { ListSource, RecentList } from './lists.model'

/*
 * Recently played over a stand-in player and a stand-in for this device's
 * prefs (the file the lists are written to): the player is what the hook
 * watches, and the file is where what it remembers ends up.
 */
const mockSaved = new Map<string, string>()
jest.mock('../../ports/prefs', () => ({
  prefs: {
    get: (key: string) => mockSaved.get(key) ?? null,
    set: (key: string, value: string) => mockSaved.set(key, value),
  },
}))

interface FakePlayer {
  source: ListSource | null
  queue: QueueState
  current: { id: number; title: string } | null
  isPlaying: boolean
}
let mockPlayer: FakePlayer
jest.mock('../../player/PlayerProvider', () => ({ usePlayer: () => mockPlayer }))

/**
 * The app as it opens: a store that reads what it holds from prefs, and a
 * renderer of its own to run it in, as each launch has.
 */
function launch(): {
  useRecordRecentLists: typeof import('./recentLists.store').useRecordRecentLists
  renderHook: typeof import('@testing-library/react-native/pure').renderHook
} {
  let app: ReturnType<typeof launch> | undefined
  jest.isolateModules(() => {
    app = {
      useRecordRecentLists: (require('./recentLists.store') as typeof import('./recentLists.store'))
        .useRecordRecentLists,
      renderHook: (
        require('@testing-library/react-native/pure') as typeof import('@testing-library/react-native/pure')
      ).renderHook,
    }
  })
  return app!
}

function remembered(): RecentList[] {
  return JSON.parse(mockSaved.get('lists.recent') ?? '[]') as RecentList[]
}

const queue = (items: number[], index = 0): QueueState => ({
  ...EMPTY_QUEUE,
  items,
  original: items,
  index,
})

const SEARCH: ListSource = { kind: 'songs', origin: 'search', name: '“yoru”' }
const TAG: ListSource = { kind: 'tag', tagId: 1, name: 'jpop' }

/** The clock the lists are timed by; not fake timers, which would hold back React's effects. */
let now = 0
function setTime(iso: string): void {
  now = Date.parse(iso)
}

beforeEach(() => {
  mockSaved.clear()
  setTime('2026-10-26T10:00:00Z')
  jest.spyOn(Date, 'now').mockImplementation(() => now)
})
afterEach(() => jest.restoreAllMocks())

describe('Recently played, as things are heard', () => {
  it('remembers a list only once a song of it plays', async () => {
    const { useRecordRecentLists, renderHook } = launch()
    mockPlayer = { source: SEARCH, queue: queue([1, 2, 3]), current: null, isPlaying: false }
    const { rerender } = await renderHook(() => useRecordRecentLists())
    mockPlayer = { ...mockPlayer, current: { id: 1, title: 'Song 1' } }
    await rerender({})
    expect(remembered()).toEqual([])

    mockPlayer = { ...mockPlayer, isPlaying: true }
    await rerender({})
    expect(remembered().map(entry => entry.key)).toEqual(['songs:search:“yoru”'])
    expect(remembered()[0]?.played).toEqual([1])
  })

  it('does not move a list put back paused as the app opens, nor for a song edited in it', async () => {
    // Earlier: the tag, then a search, the search the newest.
    const { useRecordRecentLists, renderHook } = launch()
    mockPlayer = {
      source: TAG,
      queue: queue([7, 8]),
      current: { id: 7, title: '7' },
      isPlaying: true,
    }
    const first = await renderHook(() => useRecordRecentLists())
    setTime('2026-10-26T10:05:00Z')
    mockPlayer = {
      source: SEARCH,
      queue: queue([1, 2, 3]),
      current: { id: 1, title: 'Song 1' },
      isPlaying: true,
    }
    await first.rerender({})
    mockPlayer = {
      ...mockPlayer,
      source: TAG,
      queue: queue([7, 8]),
      current: { id: 7, title: '7' },
    }
    setTime('2026-10-26T10:10:00Z')
    await first.rerender({})
    first.unmount()
    const before = remembered()
    expect(before.map(entry => entry.key)).toEqual(['tag:1', 'songs:search:“yoru”'])

    // The app opens again, an hour on, and puts the search back paused.
    setTime('2026-10-26T11:10:00Z')
    const { useRecordRecentLists: again, renderHook: renderAgain } = launch()
    mockPlayer = { source: null, queue: EMPTY_QUEUE, current: null, isPlaying: false }
    const { rerender } = await renderAgain(() => again())
    mockPlayer = {
      source: { ...SEARCH },
      queue: queue([1, 2, 3]),
      current: { id: 1, title: 'Song 1' },
      isPlaying: false,
    }
    await rerender({})
    // Its song's name fixed: the library, the queue and the song all come back new.
    mockPlayer = {
      ...mockPlayer,
      queue: queue([1, 2, 3]),
      current: { id: 1, title: 'Song 1 (fixed)' },
    }
    await rerender({})
    expect(remembered()).toEqual(before)

    // Play pressed: now it was listened to.
    mockPlayer = { ...mockPlayer, isPlaying: true }
    await rerender({})
    expect(remembered().map(entry => entry.key)).toEqual(['songs:search:“yoru”', 'tag:1'])
  })
})
