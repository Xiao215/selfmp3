import { requireOptionalNativeModule } from 'expo'

import type { RoomActivity } from '../features/room/roomActivity.model'

interface RoomActivityModule {
  /** Whether this iPhone shows Live Activities for the app at all (Settings may say no). */
  enabled(): boolean
  /** Start the room's Live Activity, or update it when it is the same room. */
  show(head: string, state: string, cover: string | null): Promise<void>
  /** Take it off the Lock Screen and out of the Dynamic Island. */
  end(): Promise<void>
}

/**
 * The room on an iPhone's Lock Screen and in its Dynamic Island: the app's own
 * module, `apps/app/modules/room-activity`, which hands ActivityKit the room
 * as the widget target draws it (`targets/widget/RoomActivity.swift`).
 *
 * `null` on Android and the web, which have no Live Activities.
 */
const module = requireOptionalNativeModule<RoomActivityModule>('RoomActivity')

/** Whether there is a Lock Screen to show a room on. */
export const hasRoomActivity = module !== null

/**
 * Show the room, or update what it shows. A refusal (Live Activities turned
 * off for the app, too many running) is not the room's problem: the room
 * goes on without one.
 */
export function showRoomActivity(activity: RoomActivity): void {
  if (!module?.enabled()) return
  void module
    .show(JSON.stringify(activity.head), JSON.stringify(activity.state), activity.cover)
    .catch(() => undefined)
}

export function endRoomActivity(): void {
  void module?.end().catch(() => undefined)
}
