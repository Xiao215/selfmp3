import { describe, expect, it, vi } from 'vitest'
import type { Api } from '../api/api.js'
import { configureClient } from '../runtime.js'
import { createListenOutbox } from './outbox.js'

/*
 * The outbox over storage held in memory, and a server that takes plays when
 * it is told to: the server is the outermost boundary here.
 */

function memoryStore() {
  let held: unknown = []
  return {
    read: () => Promise.resolve(held),
    update: (change: (current: unknown) => unknown) => {
      held = change(held)
      return Promise.resolve(held)
    },
  }
}

describe('the listen outbox', () => {
  it('sends a play recorded while a flush was already under way', async () => {
    const sent: number[] = []
    let firstAnswer = (): void => undefined
    let calls = 0
    const recordPlay = vi.fn((songId: number) => {
      calls += 1
      sent.push(songId)
      // The first send waits, so the second play is recorded mid-flush.
      return calls === 1
        ? new Promise<void>(resolve => {
            firstAnswer = resolve
          })
        : Promise.resolve()
    })
    configureClient({ api: { recordPlay } as unknown as Api })
    const outbox = createListenOutbox(memoryStore())

    outbox.recordListen(1, 60_000, true)
    await vi.waitFor(() => expect(recordPlay).toHaveBeenCalledTimes(1))
    outbox.recordListen(2, 60_000, true)
    await new Promise(resolve => setTimeout(resolve, 0))
    firstAnswer()

    await vi.waitFor(() => expect(sent).toEqual([1, 2]))
  })
})
