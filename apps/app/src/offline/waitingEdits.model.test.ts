import { afterEach, describe, expect, it, vi } from 'vitest'
import { MutationObserver, QueryClient, onlineManager } from '@tanstack/react-query'
import { configureClient, editKeys, type Api } from '@selfmp3/client'

import { keptEdits, networkModeFor, parseKept, restoreEdits } from './waitingEdits.model'

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

  it('keeps an edit still on its way as the page goes, and sends it again on the next open', async () => {
    // Sent as the tab reloads: the outbox's write never finishes.
    const before = new QueryClient()
    const observer = new MutationObserver<
      unknown,
      Error,
      { songId: number; add: number[]; remove: number[] }
    >(before, {
      mutationKey: [...editKeys.songTags],
      mutationFn: () => new Promise(() => undefined),
    })
    void observer.mutate({ songId: 9, add: [], remove: [2] })
    expect(keptEdits(before, 'cloud').mutations).toEqual([])
    const kept = parseKept(JSON.stringify(keptEdits(before, 'cloud', { sending: true })))
    expect(kept?.mutations).toHaveLength(1)

    const after = new QueryClient()
    after.mount()
    restoreEdits(after, kept, 'cloud')
    await vi.waitFor(() => expect(sent).toEqual([{ songId: 9, change: { add: [], remove: [2] } }]))
    after.unmount()
  })

  it('keeps nothing that is not waiting', () => {
    const client = new QueryClient()
    expect(keptEdits(client, 'cloud').mutations).toEqual([])
    expect(parseKept('{nope')).toBeNull()
    expect(parseKept(JSON.stringify({ library: 1, mutations: [] }))).toBeNull()
  })
})

describe('a cloud library’s edits', () => {
  /** A tag ticked as the picker ticks it, into whatever the edit is sent to. */
  const tick = (client: QueryClient, into: string[]): Promise<unknown> =>
    new MutationObserver<unknown, Error, { songId: number }>(client, {
      mutationKey: [...editKeys.songTags],
      mutationFn: () => {
        into.push('applied')
        return Promise.resolve()
      },
    })
      .mutate({ songId: 7 })
      .catch(() => undefined)

  it('reach this device’s copy at once while offline, so each is stamped when it is made', async () => {
    // Paused instead, an edit made offline reached the copy only once the
    // browser was online again, and was stamped then: an old edit beat one
    // made since on another device, and the screen never showed it meanwhile.
    const client = new QueryClient()
    networkModeFor(client, true)
    onlineManager.setOnline(false)
    const applied: string[] = []
    await tick(client, applied)
    expect(applied).toEqual(['applied'])
    expect(keptEdits(client, 'cloud').mutations).toEqual([])
  })

  it('leave a server’s edits waiting for the network, as they must', async () => {
    const client = new QueryClient()
    networkModeFor(client, true)
    networkModeFor(client, false)
    onlineManager.setOnline(false)
    const applied: string[] = []
    void tick(client, applied)
    await Promise.resolve()
    expect(applied).toEqual([])
    expect(keptEdits(client, 'http://pi:4600').mutations).toHaveLength(1)
  })
})
