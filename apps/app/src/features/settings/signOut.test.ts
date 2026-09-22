import { describe, expect, it } from 'vitest'
import { signOutOfCloud, signOutWarning, type SignOutSteps } from './signOut'

function recorder(overrides: Partial<SignOutSteps> = {}): { steps: SignOutSteps; calls: string[] } {
  const calls: string[] = []
  const step = (name: string) => () => {
    calls.push(name)
    return Promise.resolve()
  }
  return {
    calls,
    steps: {
      stopPlaying: () => void calls.push('stop'),
      sendPendingChanges: step('send'),
      endSession: step('end'),
      forgetLibrary: step('forget-library'),
      removeDownloads: step('remove-downloads'),
      forgetSavedLibrary: step('forget-saved'),
      done: () => void calls.push('done'),
      ...overrides,
    },
  }
}

describe('signing out of the cloud', () => {
  it('stops the music, sends what is waiting, ends the session, forgets what was kept, then hands back', async () => {
    const { steps, calls } = recorder()
    await signOutOfCloud(steps)
    expect(calls.slice(0, 3)).toEqual(['stop', 'send', 'end'])
    expect([...calls.slice(3, 6)].sort()).toEqual([
      'forget-library',
      'forget-saved',
      'remove-downloads',
    ])
    expect(calls[6]).toBe('done')
  })

  it('signs out even when the waiting changes cannot be sent', async () => {
    const { steps, calls } = recorder({
      sendPendingChanges: () => Promise.reject(new Error('offline')),
    })
    await signOutOfCloud(steps)
    expect(calls).toContain('end')
    expect(calls.at(-1)).toBe('done')
  })

  it('still hands back when forgetting one of the kept things fails', async () => {
    const { steps, calls } = recorder({ removeDownloads: () => Promise.reject(new Error('quota')) })
    await signOutOfCloud(steps)
    expect(calls).toEqual(expect.arrayContaining(['forget-library', 'forget-saved']))
    expect(calls.at(-1)).toBe('done')
  })

  it('does not hand back when the session could not be ended', async () => {
    const { steps, calls } = recorder({ endSession: () => Promise.reject(new Error('no storage')) })
    await expect(signOutOfCloud(steps)).rejects.toThrow('no storage')
    expect(calls).not.toContain('done')
  })
})

describe('the sign-out warning', () => {
  it('says the music stays, and counts what would be lost', () => {
    expect(signOutWarning(0)).toBe(
      'Songs downloaded to this device are removed; your music stays in the bucket.',
    )
    expect(signOutWarning(1)).toMatch(
      /1 change made here has not reached it yet and will be lost if it cannot be sent now\.$/,
    )
    expect(signOutWarning(3)).toMatch(
      /3 changes made here have not reached it yet and will be lost if they cannot be sent now\.$/,
    )
  })
})
