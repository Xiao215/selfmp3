import { RoomError } from '@selfmp3/client'
import { showToast } from '../../ui/toast'

/** A room action's failure, in the room's own words (apps/doorman's rooms.ts writes them). */
export function sayRoomFailure(error: unknown): void {
  const message =
    error instanceof RoomError ? error.message : 'the room could not be reached; try again'
  showToast(message.charAt(0).toLocaleUpperCase() + message.slice(1), 'error')
}
