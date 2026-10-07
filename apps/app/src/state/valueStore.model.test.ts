import { describe, expect, it, vi } from 'vitest'

import { samePlayback } from '../player/progress.model'
import { createValueStore } from './valueStore.model'

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
