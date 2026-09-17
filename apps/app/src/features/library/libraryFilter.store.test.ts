import { describe, expect, it } from 'vitest'
import { clearTagFilter, DEFAULT_FILTER, toggleTag } from '@selfmp3/client'

import { createLibraryFilterStore } from './libraryFilter.store'

describe('the library filter store', () => {
  it('takes values and updaters the way useState does', () => {
    const store = createLibraryFilterStore()
    expect(store.get()).toBe(DEFAULT_FILTER)
    store.set(current => ({ ...current, query: 'a' }))
    store.set(current => ({ ...current, query: `${current.query}b` }))
    expect(store.get().query).toBe('ab')
    const replaced = { ...DEFAULT_FILTER, sort: 'title' as const }
    store.set(replaced)
    expect(store.get()).toBe(replaced)
  })

  it('tells readers about a change, and not about the same value again', () => {
    const store = createLibraryFilterStore()
    let heard = 0
    const stop = store.subscribe(() => heard++)
    store.set(current => toggleTag(current, 7))
    expect(heard).toBe(1)
    // Clearing twice: the second returns the filter it was given.
    store.set(clearTagFilter)
    store.set(clearTagFilter)
    expect(heard).toBe(2)
    stop()
    store.set(current => ({ ...current, query: 'x' }))
    expect(heard).toBe(2)
  })

  it('keeps the tag list the same array while only the query changes', () => {
    const store = createLibraryFilterStore()
    store.set(current => toggleTag(current, 7))
    const { tagIds } = store.get()
    store.set(current => ({ ...current, query: 'typing' }))
    expect(store.get().tagIds).toBe(tagIds)
  })
})
