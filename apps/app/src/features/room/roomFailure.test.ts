import { describe, expect, it, vi } from 'vitest'
import { DOORMAN_ERROR, DoormanError } from '@selfmp3/shared'

const toasts = vi.hoisted(() => [] as string[])
vi.mock('../../ui/toast', () => ({ showToast: (text: string) => toasts.push(text) }))

const { sayRoomFailure } = await import('./roomFailure')

describe('a room action that failed', () => {
  it('says the doorman’s own words, and plain ones when it was never reached', () => {
    sayRoomFailure(new DoormanError(403, DOORMAN_ERROR.roomForbidden, 'only the host can skip'))
    // Offline: what the browser's fetch says, wrapped (packages/shared's doormanClient).
    sayRoomFailure(new DoormanError(0, DOORMAN_ERROR.unreachable, 'Failed to fetch'))
    sayRoomFailure(new TypeError('Failed to fetch'))
    expect(toasts).toEqual([
      'Only the host can skip',
      'The room could not be reached; try again',
      'The room could not be reached; try again',
    ])
  })
})
