import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Song } from '@selfmp3/shared'
import { ApiError } from '@selfmp3/client'
import {
  currentToasts,
  dismissToast,
  sendPending,
  showFailure,
  showPendingToast,
  showUndoToast,
} from './toast'

function pressUndo(): void {
  const undo = currentToasts()
    .at(-1)
    ?.actions.find(action => action.label === 'Undo')
  undo?.onPress()
}

/** Lets the undo's promise and what follows it run. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) await Promise.resolve()
}

afterEach(() => {
  sendPending()
  for (const toast of currentToasts()) dismissToast(toast.id)
  vi.useRealTimers()
})

describe('an undo toast', () => {
  it('says the undo is done once work that takes a while has finished', async () => {
    let finish: () => void = () => undefined
    showUndoToast('Fixed 3 songs', () => new Promise<void>(done => (finish = done)), {
      tone: 'good',
      after: 'Put back 3 songs',
    })
    expect(currentToasts().at(-1)).toMatchObject({ say: 'Fixed 3 songs', tone: 'good' })
    pressUndo()
    await settle()
    expect(currentToasts().map(toast => toast.say)).not.toContain('Put back 3 songs')
    finish()
    await settle()
    expect(currentToasts().at(-1)).toMatchObject({ say: 'Put back 3 songs', tone: 'info' })
  })

  it('says it failed when asked to, and stays quiet when the edit said so itself', async () => {
    showUndoToast('Renamed', () => Promise.reject(new Error('down')), {
      failed: 'Couldn’t undo that',
    })
    pressUndo()
    await settle()
    expect(currentToasts().at(-1)).toMatchObject({ say: 'Couldn’t undo that', tone: 'error' })

    showUndoToast('Sorted', () => Promise.reject(new Error('down')))
    const before = currentToasts().length
    pressUndo()
    await settle()
    expect(currentToasts()).toHaveLength(before)
  })

  it('puts its other words before Undo, and lasts as long as any undo', () => {
    showUndoToast('Saved “Evening”', () => undefined, {
      also: [{ label: 'Open', onPress: () => undefined }],
    })
    const toast = currentToasts().at(-1)
    expect(toast?.actions.map(action => action.label)).toEqual(['Open', 'Undo'])
    expect(toast?.autoDismissMs).toBe(5000)
  })
})

/**
 * A pending toast says something is done before it is sent, as an email
 * client's undo-send (the fold of an extra copy, which cannot be taken back).
 */
describe('a pending toast', () => {
  it('sends once its Undo has gone, and not before', async () => {
    vi.useFakeTimers()
    const send = vi.fn()
    showPendingToast('Deleted the extra copy', send, { tone: 'good' })
    expect(currentToasts().at(-1)).toMatchObject({ say: 'Deleted the extra copy', tone: 'good' })

    await vi.advanceTimersByTimeAsync(4900)
    expect(send).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)
    expect(send).toHaveBeenCalledTimes(1)
    expect(currentToasts().map(toast => toast.say)).not.toContain('Deleted the extra copy')
  })

  it('sends nothing at all after Undo, and puts back what was set aside', async () => {
    vi.useFakeTimers()
    const send = vi.fn()
    const undone = vi.fn()
    showPendingToast('Deleted the extra copy', send, { undone })
    pressUndo()
    expect(undone).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(10_000)
    sendPending()
    await settle()
    expect(send).not.toHaveBeenCalled()
  })

  it('sends at once when the app is leaving, and only once', async () => {
    const send = vi.fn()
    showPendingToast('Deleted 2 extra copies', send)
    sendPending()
    await settle()
    expect(send).toHaveBeenCalledTimes(1)
    // The message goes with it: its Undo can no longer be kept.
    expect(currentToasts().map(toast => toast.say)).not.toContain('Deleted 2 extra copies')
    sendPending()
    await settle()
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('says it failed when sending does', async () => {
    showPendingToast('Deleted the extra copy', () => Promise.reject(new Error('down')), {
      failed: 'Couldn’t delete it',
    })
    sendPending()
    await settle()
    expect(currentToasts().at(-1)).toMatchObject({ say: 'Couldn’t delete it', tone: 'error' })
  })
})

/** Messages of one kind raised while the last is up fold into it (E2). */
describe('a folded message', () => {
  const song = (id: number, title: string): Song => ({ id, title }) as Song

  it('counts its songs, keeps one id, and undoes all of them newest first', async () => {
    const order: string[] = []
    showUndoToast({ over: 'Removed from Up next', say: 'One' }, () => order.push('one'), {
      songs: [song(1, 'One')],
      group: 'removed',
    })
    const first = currentToasts().at(-1)
    showUndoToast({ over: 'Removed from Up next', say: 'Two' }, () => order.push('two'), {
      songs: [song(2, 'Two')],
      group: 'removed',
    })
    expect(currentToasts()).toHaveLength(1)
    const folded = currentToasts().at(-1)
    expect(folded).toMatchObject({ id: first?.id, over: 'Removed from Up next', say: '2 songs' })
    expect(folded?.actions.map(action => action.label)).toEqual(['Undo all'])
    folded?.actions[0]?.onPress()
    await settle()
    expect(order).toEqual(['two', 'one'])
  })

  it('waits as long as its newest says, then sends every one', async () => {
    vi.useFakeTimers()
    const send = vi.fn()
    showPendingToast('A', () => send('a'), { group: 'gone', songs: [song(1, 'A')] })
    await vi.advanceTimersByTimeAsync(4000)
    showPendingToast('B', () => send('b'), { group: 'gone', songs: [song(2, 'B')] })
    await vi.advanceTimersByTimeAsync(4000)
    expect(send).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(send.mock.calls).toEqual([['a'], ['b']])
  })

  it('undoes every send folded into it', async () => {
    vi.useFakeTimers()
    const send = vi.fn()
    const undone = vi.fn()
    showPendingToast('A', send, { group: 'gone', undone })
    showPendingToast('B', send, { group: 'gone', undone })
    currentToasts().at(-1)?.actions[0]?.onPress()
    expect(undone).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(send).not.toHaveBeenCalled()
  })
})

describe('a failure', () => {
  it('puts the reason under what did not happen', () => {
    showFailure('Couldn’t save it', new ApiError(0, 'offline', 'offline'))
    expect(currentToasts().at(-1)).toMatchObject({
      say: 'Couldn’t save it',
      under: 'Your library isn’t reachable right now.',
      tone: 'error',
    })
  })
})
