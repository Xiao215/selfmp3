import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@selfmp3/client'
import { currentToasts, dismissToast } from '../../ui/toast'
import { forgetEach } from './forgetDevices'

afterEach(() => {
  for (const toast of currentToasts()) dismissToast(toast.id)
})

const failures = (): string[] =>
  currentToasts()
    .filter(toast => toast.tone === 'error')
    .map(toast => toast.say)

describe('forgetting devices', () => {
  it('sends a device once while its removal is on its way: a double click is one press', async () => {
    let finish: () => void = () => undefined
    const forgetDevice = vi.fn(
      () => new Promise<{ ok: true }>(done => (finish = () => done({ ok: true }))),
    )
    const first = forgetEach({ forgetDevice }, ['phone'])
    const second = forgetEach({ forgetDevice }, ['phone'])
    finish()
    await Promise.all([first, second])
    expect(forgetDevice).toHaveBeenCalledTimes(1)
    expect(failures()).toEqual([])

    // Once it has been answered, a press is a press again.
    forgetDevice.mockResolvedValueOnce({ ok: true })
    await forgetEach({ forgetDevice }, ['phone'])
    expect(forgetDevice).toHaveBeenCalledTimes(2)
  })

  it('takes a device the server no longer has as forgotten, not refused', async () => {
    const forgetDevice = vi.fn(() =>
      Promise.reject(new ApiError(404, 'no device with id phone', 'not_found')),
    )
    await forgetEach({ forgetDevice }, ['phone'])
    expect(failures()).toEqual([])
  })

  it('still says so when the server refused', async () => {
    const forgetDevice = vi.fn(() => Promise.reject(new ApiError(0, 'offline', 'offline')))
    await forgetEach({ forgetDevice }, ['phone'])
    expect(failures()).toEqual(['Couldn’t remove that device'])
  })
})
