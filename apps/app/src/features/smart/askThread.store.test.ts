import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AskReply } from '@selfmp3/shared'
import type { Turn } from './askTurns.model'

// The tab's session outlives a reload, and the device's prefs outlive the
// app; the store's memory outlives neither.
const tab = vi.hoisted(() => new Map<string, string>())
const device = vi.hoisted(() => new Map<string, string>())
vi.mock('../../ports/tabSession', () => ({
  readTabSession: (key: string) => tab.get(key) ?? null,
  writeTabSession: (key: string, value: string) => tab.set(key, value),
}))
vi.mock('../../ports/prefs', () => ({
  prefs: {
    get: (key: string) => device.get(key) ?? null,
    set: (key: string, value: string) => device.set(key, value),
  },
}))

type Store = typeof import('./askThread.store')

/** The page's store as a reload finds it: its memory gone, the tab and the device kept. */
async function reloaded(): Promise<Store> {
  vi.resetModules()
  return import('./askThread.store')
}

const skipped: AskReply = {
  say: null,
  cards: [{ kind: 'playback', op: 'next', place: null }],
  from: [],
}

const turn = (id: number, asked: string, patch: Partial<Turn> = {}): Turn => ({
  id,
  asked,
  playing: null,
  screen: null,
  before: [],
  answered: 'Skipped to the next song.',
  outcomes: {},
  objects: [],
  lists: [],
  kinds: ['playback'],
  reply: skipped,
  carried: { 0: 'Skipped to Monster.' },
  broughtBack: false,
  ...patch,
})

beforeEach(() => {
  tab.clear()
  device.clear()
})

describe('askThread.store', () => {
  it('finds the turns of a page drawn again on its thread', async () => {
    const store = await reloaded()
    const turns = [turn(1, 'play kite club'), turn(2, 'only the slow ones')]
    store.keepThread('a1', turns)
    expect(store.keptThread('a1')).toBe(turns)
  })

  it('brings a conversation back after the app starts again, marked so nothing in it is done again', async () => {
    const before = await reloaded()
    before.keepThread('a1', [turn(1, 'skip this song')])
    const after = await reloaded()
    const back = after.keptThread('a1')
    expect(back?.map(each => each.asked)).toEqual(['skip this song'])
    expect(back?.[0]?.reply).toEqual(skipped)
    expect(back?.[0]?.carried).toEqual({ 0: 'Skipped to Monster.' })
    expect(back?.[0]?.broughtBack).toBe(true)
  })

  it('keeps only what was answered, and opens a reloaded thread with nothing answered as asked', async () => {
    const before = await reloaded()
    before.keepThread('a1', [turn(1, 'skip this song', { answered: null, reply: null })])
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

  it('lists the newest conversation first, by its first question', async () => {
    const store = await reloaded()
    store.keepThread('a1', [turn(1, 'calm songs for studying')])
    store.keepThread('b2', [turn(2, 'tag my untagged songs')])
    // A follow-up in the first moves it back to the front.
    store.keepThread('a1', [turn(1, 'calm songs for studying'), turn(3, 'only piano')])
    const after = await reloaded()
    expect(after.keptThread('a1')).toHaveLength(2)
    expect(after.askedThreads().map(each => [each.thread, each.asked, each.questions])).toEqual([
      ['a1', 'calm songs for studying', 2],
      ['b2', 'tag my untagged songs', 1],
    ])
  })

  it('keeps a room’s conversation for the visit only', async () => {
    const before = await reloaded()
    before.keepThread('r1', [turn(1, 'add something upbeat')], false)
    expect(before.keptThread('r1')).toHaveLength(1)
    const after = await reloaded()
    expect(after.keptThread('r1')).toEqual([])
  })
})
