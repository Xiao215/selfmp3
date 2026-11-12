import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Turn } from './askTurns.model'

// The tab's session outlives a reload; the store's memory does not.
const tab = vi.hoisted(() => new Map<string, string>())
vi.mock('../../ports/tabSession', () => ({
  readTabSession: (key: string) => tab.get(key) ?? null,
  writeTabSession: (key: string, value: string) => tab.set(key, value),
}))

type Store = typeof import('./askThread.store')

/** The page's store as a reload finds it: its memory gone, the tab's session kept. */
async function reloaded(): Promise<Store> {
  vi.resetModules()
  return import('./askThread.store')
}

const turn = (id: number, asked: string): Turn => ({
  id,
  asked,
  playing: null,
  screen: null,
  before: [],
  answered: 'Skipped to the next song.',
  outcomes: {},
  objects: [],
  lists: [],
})

beforeEach(() => tab.clear())

describe('askThread.store', () => {
  it('finds the turns of a page drawn again on its thread', async () => {
    const store = await reloaded()
    const turns = [turn(1, 'play kite club'), turn(2, 'only the slow ones')]
    store.keepThread('a1', turns)
    expect(store.keptThread('a1')).toBe(turns)
  })

  it('opens a reloaded thread with nothing asked, so its question is not asked and done again', async () => {
    const before = await reloaded()
    before.keepThread('a1', [turn(1, 'skip this song')])
    const after = await reloaded()
    expect(after.keptThread('a1')).toEqual([])
  })

  it('asks a thread not asked yet', async () => {
    const store = await reloaded()
    expect(store.keptThread('a1')).toBeUndefined()
  })

  it('starts the same words asked again on a new visit afresh', async () => {
    const store = await reloaded()
    const first = store.newThread()
    store.keepThread(first, [turn(1, 'skip this song')])
    const again = store.newThread()
    expect(again).not.toBe(first)
    expect(store.keptThread(again)).toBeUndefined()
  })

  it('lets a conversation go on ‹ without asking it again when its page comes back', async () => {
    const store = await reloaded()
    store.keepThread('a1', [turn(1, 'skip this song')])
    store.forgetThread('a1')
    expect(store.keptThread('a1')).toEqual([])
  })
})
