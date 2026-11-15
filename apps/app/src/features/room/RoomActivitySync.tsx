import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { yoursOf } from '@selfmp3/client'
import type { RoomState } from '@selfmp3/shared'
import {
  coverFor,
  coversVersion,
  pictureFor,
  picturesVersion,
  subscribeCovers,
  subscribePictures,
} from '../../offline/covers'
import { endRoomActivity, hasRoomActivity, showRoomActivity } from '../../ports/roomActivity'
import { useLibraryIndex } from '../../ui/songsById'
import { activityChanged, roomActivity, type RoomActivity } from './roomActivity.model'
import { useRoom } from './room.store'

/**
 * Keeps the room on an iPhone's Lock Screen and in its Dynamic Island while
 * this phone is in one, and takes it away when the room ends or is left
 * (docs/features/listen-together.md, "On the Lock Screen"). Draws nothing.
 *
 * Mounted once in the shell, beside the widget's sync, because a room
 * outlives every screen. Where there are no Live Activities it does no work.
 */
export function RoomActivitySync(): ReactNode {
  return hasRoomActivity ? <Sync /> : null
}

function Sync(): ReactNode {
  const { pass, state, offset, link } = useRoom()
  const index = useLibraryIndex()
  // A cover arriving after its song started is news: the Lock Screen gets it.
  const covers = useSyncExternalStore(subscribeCovers, coversVersion, coversVersion)
  const pictures = useSyncExternalStore(subscribePictures, picturesVersion, picturesVersion)
  const sent = useRef<RoomActivity | null>(null)
  /** Whether a Live Activity left over from before this launch was taken away. */
  const tidied = useRef(false)

  useEffect(() => {
    /*
     * The playing song's cover as a file here, which the module makes small
     * for the Lock Screen: your own copy's, or the friend's the room lent and
     * the room's provider keeps (`keepLent`). Never fetched again for this.
     */
    const coverOf = (room: RoomState): string | null => {
      const entry = room.entries.find(each => each.id === room.playing?.entryId)
      if (!entry) return null
      const yours = yoursOf(entry.song, index)
      if (yours !== null) return coverFor(yours) ?? null
      return entry.song.cover ? (pictureFor(entry.song.cover.key) ?? null) : null
    }
    const next = roomActivity({ state, offset, link, coverOf })
    // Opened in no room, with one still on the Lock Screen from when the app
    // was last stopped in it: that room is over for this phone.
    if (!pass && !tidied.current) {
      tidied.current = true
      if (!next) endRoomActivity()
    }
    if (!activityChanged(sent.current, next)) return
    sent.current = next
    if (next) showRoomActivity(next)
    else endRoomActivity()
  }, [pass, state, offset, link, index, covers, pictures])

  return null
}
