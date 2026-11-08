import { DOORMAN_ERROR, DoormanError } from '@selfmp3/shared'
import { showToast } from '../../ui/toast'

/**
 * A room action's failure, in the room's own words (apps/doorman's rooms.ts
 * writes them). A doorman never reached has none: the browser's own word for
 * that ("Failed to fetch") says nothing to anyone.
 */
export function sayRoomFailure(error: unknown): void {
  const message =
    error instanceof DoormanError && error.code !== DOORMAN_ERROR.unreachable
      ? error.message
      : 'the room could not be reached; try again'
  showToast(message.charAt(0).toLocaleUpperCase() + message.slice(1), 'error')
}
