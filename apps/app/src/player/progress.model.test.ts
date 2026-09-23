import { describe, expect, it, vi } from 'vitest'

import {
  createProgressStore,
  createValueStore,
  differsBesidesClock,
  positionJumped,
  samePlayback,
  songPlayback,
} from './progress.model'

describe('a value store', () => {
  it('tells subscribers only about real changes', () => {
    const store = createValueStore(1)
    const listener = vi.fn()
    store.subscribe(listener)
    store.set(1)
    expect(listener).not.toHaveBeenCalled()
    store.set(2)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.get()).toBe(2)
  })

  it('uses the equality it is given, so a rebuilt object is not a change', () => {
    const store = createValueStore({ songId: 1, playing: true }, samePlayback)
    const listener = vi.fn()
    store.subscribe(listener)
    store.set({ songId: 1, playing: true })
    expect(listener).not.toHaveBeenCalled()
    store.set({ songId: 1, playing: false })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('stops telling a listener that unsubscribed', () => {
    const store = createValueStore('a')
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    unsubscribe()
    store.set('b')
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('the progress store', () => {
  it('keeps the same snapshot until something moves', () => {
    const store = createProgressStore()
    store.follow(1)
    store.set(1, 3, 200)
    const first = store.get()
    store.set(1, 3, 200)
    // useSyncExternalStore loops forever on a snapshot that is new every read.
    expect(store.get()).toBe(first)
    store.set(1, 3.25, 200)
    expect(store.get()).not.toBe(first)
    expect(store.getPosition()).toBe(3.25)
  })

  it('starts the clock again the moment the song changes', () => {
    const store = createProgressStore()
    store.follow(1)
    store.set(1, 128, 200)

    store.follow(2)
    // Not 128 for the fraction of a second before the player's first tick.
    expect(store.get()).toEqual({ position: 0, duration: 0 })
  })

  it('drops a tick the song being left still had in it', () => {
    const store = createProgressStore()
    store.follow(1)
    store.set(1, 128, 200)
    store.follow(2)

    // The engine plays song 1 on until song 2 is open, and a phone's player
    // reports a position once a second: this tick is song 1's.
    store.set(1, 129, 200)
    expect(store.getPosition()).toBe(0)

    store.set(2, 0.5, 240)
    expect(store.get()).toEqual({ position: 0.5, duration: 240 })
  })

  it('resumes where it left off, so a restored song does not flash 0:00', () => {
    const store = createProgressStore()
    store.follow(7, 203)
    expect(store.getPosition()).toBe(203)
  })

  it('leaves the sounding song’s clock alone when it is asked for again', () => {
    const store = createProgressStore()
    store.follow(7)
    store.set(7, 92, 240)

    // Tapping the row of the song that is already playing: the engine leaves
    // it where it is, so 0:00 here would be a second of fiction.
    store.follow(7)
    expect(store.get()).toEqual({ position: 92, duration: 240 })

    // Saying where to begin is a different request, and it does move.
    store.follow(7, 0)
    expect(store.getPosition()).toBe(0)
  })
})

describe('a row’s view of the player', () => {
  it('is null for every song but the loaded one', () => {
    expect(songPlayback({ songId: 7, playing: true }, 8)).toBeNull()
    expect(songPlayback({ songId: null, playing: false }, 8)).toBeNull()
  })

  it('says whether the loaded song is sounding', () => {
    expect(songPlayback({ songId: 7, playing: true }, 7)).toBe('playing')
    expect(songPlayback({ songId: 7, playing: false }, 7)).toBe('paused')
  })
})

describe('what counts as the engine changing', () => {
  const base = {
    playing: true,
    currentTime: 10,
    duration: 200,
    volume: 1,
    loopA: null as number | null,
  }

  it('ignores the clock', () => {
    expect(differsBesidesClock(base, { ...base, currentTime: 11, duration: 201 })).toBe(false)
  })

  it('notices anything else', () => {
    expect(differsBesidesClock(base, { ...base, playing: false })).toBe(true)
    expect(differsBesidesClock(base, { ...base, loopA: 3 })).toBe(true)
  })
})

describe('telling a seek from playing on', () => {
  const last = { position: 30, at: 1_000, playing: true, rate: 1 }

  it('is not a jump when the time passed explains it', () => {
    expect(positionJumped(last, 35, 6_000)).toBe(false)
    // A phone's tick a second late is still playing on.
    expect(positionJumped(last, 36, 6_000)).toBe(false)
  })

  it('is a jump forward or back beyond that', () => {
    expect(positionJumped(last, 90, 6_000)).toBe(true)
    expect(positionJumped(last, 5, 6_000)).toBe(true)
  })

  it('counts the rate, and a paused position does not move', () => {
    expect(positionJumped({ ...last, rate: 2 }, 40, 6_000)).toBe(false)
    expect(positionJumped({ ...last, playing: false }, 30, 60_000)).toBe(false)
    expect(positionJumped({ ...last, playing: false }, 45, 2_000)).toBe(true)
  })
})
