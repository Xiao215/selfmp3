import { describe, expect, it, vi } from 'vitest'
import type { OutboxEvent } from '@selfmp3/shared'
import type { createListenOutbox } from '@selfmp3/client'

type OutboxStore = Parameters<typeof createListenOutbox>[0]

/**
 * The phone's outbox file, under the package's rules: what it is asked to
 * change is the list as it stands now, so two plays written in one tick are
 * both kept.
 */

const disk = vi.hoisted(() => ({ text: null as string | null }))
vi.mock('expo-file-system', () => ({
  Paths: { document: '/documents' },
  File: class {
    get exists(): boolean {
      return disk.text !== null
    }
    text(): Promise<string> {
      return Promise.resolve(disk.text ?? '')
    }
    write(text: string): void {
      disk.text = text
    }
  },
}))

const kept = vi.hoisted(() => ({ store: null as OutboxStore | null }))
vi.mock('@selfmp3/client', () => ({
  createListenOutbox: (store: OutboxStore) => {
    kept.store = store
    return { flushListens: () => undefined, recordListen: () => undefined }
  },
}))

await import('./listenOutbox')

const play = (id: string): OutboxEvent => ({
  kind: 'play',
  id,
  songId: 1,
  msPlayed: 30_000,
  completed: false,
  playedAt: '2026-11-11T12:00:00.000Z',
})

describe("the phone's listen outbox", () => {
  it('keeps two plays written in the same tick', async () => {
    const store = kept.store
    if (!store) throw new Error('the outbox was not made')
    const add =
      (event: OutboxEvent) =>
      (current: unknown): OutboxEvent[] => [...(current as OutboxEvent[]), event]

    await store.read()
    await Promise.all([store.update(add(play('a'))), store.update(add(play('b')))])

    const ids = (await store.update(current => current as OutboxEvent[])).map(event => event.id)
    expect(ids).toEqual(['a', 'b'])
    expect(JSON.parse(disk.text ?? '[]')).toHaveLength(2)
  })
})
