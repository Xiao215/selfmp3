import { afterEach, describe, expect, it, vi } from 'vitest'

import { currentToasts, dismissToast, sendPending, showPendingToast, showUndoToast } from './toast'

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
    expect(currentToasts().at(-1)).toMatchObject({ text: 'Fixed 3 songs', tone: 'good' })
    pressUndo()
    await settle()
    expect(currentToasts().map(toast => toast.text)).not.toContain('Put back 3 songs')
    finish()
    await settle()
    expect(currentToasts().at(-1)).toMatchObject({ text: 'Put back 3 songs', tone: 'info' })
  })

  it('says it failed when asked to, and stays quiet when the edit said so itself', async () => {
    showUndoToast('Renamed', () => Promise.reject(new Error('down')), {
      failed: 'Couldn’t undo that',
    })
    pressUndo()
    await settle()
    expect(currentToasts().at(-1)).toMatchObject({ text: 'Couldn’t undo that', tone: 'error' })

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
    expect(currentToasts().at(-1)).toMatchObject({ text: 'Deleted the extra copy', tone: 'good' })

    await vi.advanceTimersByTimeAsync(4900)
    expect(send).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)
    expect(send).toHaveBeenCalledTimes(1)
    expect(currentToasts().map(toast => toast.text)).not.toContain('Deleted the extra copy')
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
    expect(currentToasts().map(toast => toast.text)).not.toContain('Deleted 2 extra copies')
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
    expect(currentToasts().at(-1)).toMatchObject({ text: 'Couldn’t delete it', tone: 'error' })
  })
})
