import { afterEach, describe, expect, it, vi } from 'vitest'
import { MutationObserver, QueryClient, onlineManager } from '@tanstack/react-query'
import { configureClient, editKeys, type Api } from '@selfmp3/client'

import { keptEdits, parseKept, restoreEdits } from './waitingEdits.model'

/*
 * An edit made offline, the page reloaded, and the edit sent once online —
 * through a real query client each side, and a stub library that records what
 * reached it.
 */

const sent: unknown[] = []
configureClient({
  api: {
    changeSongTags: (songId: number, change: unknown) => {
      sent.push({ songId, change })
      return Promise.resolve({ id: songId, tagIds: [1] })
    },
    library: () => new Promise(() => undefined),
    onCloudLibraryChanged: () => () => undefined,
    answersFromCloud: () => false,
  } as unknown as Api,
})

afterEach(() => {
  onlineManager.setOnline(true)
  sent.length = 0
})

/** Tick a tag while offline, as the picker would. */
function tickOffline(client: QueryClient): void {
  onlineManager.setOnline(false)
  const observer = new MutationObserver<
    unknown,
    Error,
    { songId: number; add: number[]; remove: number[] }
  >(client, {
    mutationKey: [...editKeys.songTags],
    mutationFn: () => Promise.reject(new Error('the hook’s own function is not what is kept')),
    meta: { failure: 'Couldn’t change the song’s tags' },
  })
  void observer.mutate({ songId: 7, add: [1], remove: [] }).catch(() => undefined)
}

describe('edits kept while the library is out of reach', () => {
  it('keeps an edit made offline, and sends it after a reload once online', async () => {
    const before = new QueryClient()
    tickOffline(before)
    const kept = parseKept(JSON.stringify(keptEdits(before, 'http://pi:4600')))
    expect(kept?.mutations).toHaveLength(1)
    expect(sent).toEqual([])

    // The page again, still offline: put back, not sent.
    const after = new QueryClient()
    after.mount()
    restoreEdits(after, kept, 'http://pi:4600')
    await Promise.resolve()
    expect(sent).toEqual([])
    expect(keptEdits(after, 'http://pi:4600').mutations).toHaveLength(1)

    onlineManager.setOnline(true)
    await vi.waitFor(() => expect(sent).toEqual([{ songId: 7, change: { add: [1], remove: [] } }]))
    after.unmount()
  })

  it('never sends one library’s edits to another', async () => {
    const before = new QueryClient()
    tickOffline(before)
    const kept = keptEdits(before, 'http://pi:4600')
    onlineManager.setOnline(true)

    const after = new QueryClient()
    restoreEdits(after, kept, 'http://other:4600')
    await Promise.resolve()
    expect(after.getMutationCache().getAll()).toHaveLength(0)
    expect(sent).toEqual([])
  })

  it('keeps nothing that is not waiting', () => {
    const client = new QueryClient()
    expect(keptEdits(client, 'cloud').mutations).toEqual([])
    expect(parseKept('{nope')).toBeNull()
    expect(parseKept(JSON.stringify({ library: 1, mutations: [] }))).toBeNull()
  })
})
