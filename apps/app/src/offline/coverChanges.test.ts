import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createCoverChanges, watchCovers } from './coverChanges'

describe('cover changes', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('gathers a frame of arrivals into one announcement naming each song', () => {
    const changes = createCoverChanges()
    const heard: number[][] = []
    changes.subscribe(changed => heard.push([...changed]))
    changes.changed(1)
    changes.changed(2)
    changes.changed(1)
    expect(heard).toEqual([])
    expect(changes.version()).toBe(0)
    vi.advanceTimersByTime(16)
    expect(heard).toEqual([[1, 2]])
    expect(changes.version()).toBe(1)
  })

  it('starts the next frame empty, and stops telling a reader who left', () => {
    const changes = createCoverChanges()
    const heard: number[][] = []
    const stop = changes.subscribe(changed => heard.push([...changed]))
    changes.changed(1)
    vi.advanceTimersByTime(16)
    changes.changed(3)
    vi.advanceTimersByTime(16)
    expect(heard).toEqual([[1], [3]])
    stop()
    changes.changed(4)
    vi.advanceTimersByTime(16)
    expect(heard).toHaveLength(2)
    expect(changes.version()).toBe(3)
  })
})

describe('a screen watching covers', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders for the covers it drew and not for anyone else’s', () => {
    const changes = createCoverChanges()
    const watch = watchCovers(changes)
    let renders = 0
    watch.subscribe(() => renders++)
    watch.ask(1)
    watch.ask(2)
    const before = watch.seen()

    changes.changed(99)
    vi.advanceTimersByTime(16)
    expect(renders).toBe(0)
    expect(watch.seen()).toBe(before)

    changes.changed(99)
    changes.changed(2)
    vi.advanceTimersByTime(16)
    expect(renders).toBe(1)
    expect(watch.seen()).not.toBe(before)
  })

  it('remembers songs asked about in an earlier render', () => {
    const changes = createCoverChanges()
    const watch = watchCovers(changes)
    let renders = 0
    watch.subscribe(() => renders++)
    watch.ask(5)
    // Later renders ask about other songs, or none: a memoized screen does not ask again.
    watch.ask(6)
    changes.changed(5)
    vi.advanceTimersByTime(16)
    expect(renders).toBe(1)
  })

  it('does not miss a cover announced before it started listening', () => {
    const changes = createCoverChanges()
    const watch = watchCovers(changes)
    watch.ask(1)
    const rendered = watch.seen()
    changes.changed(1)
    vi.advanceTimersByTime(16)
    // What useSyncExternalStore does after subscribing: compare the snapshot.
    watch.subscribe(() => undefined)
    expect(watch.seen()).not.toBe(rendered)
  })

  it('leaves the snapshot alone when nothing was announced before listening', () => {
    const changes = createCoverChanges()
    const watch = watchCovers(changes)
    const rendered = watch.seen()
    watch.subscribe(() => undefined)
    expect(watch.seen()).toBe(rendered)
  })
})
