import { afterEach, describe, expect, it } from 'vitest'

import { currentToasts, dismissToast, showUndoToast } from './toast'

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
  for (const toast of currentToasts()) dismissToast(toast.id)
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
