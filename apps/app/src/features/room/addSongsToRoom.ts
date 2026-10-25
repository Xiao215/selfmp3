import { plural } from '@selfmp3/shared'
import { library as cloudLibrary } from '../../replica'
import { showToast } from '../../ui/toast'
import { sayRoomFailure } from './roomFailure'
import { roomAct } from './room.store'

/**
 * Songs of yours into the room you are in, in order, as yours: a list's ⋯ in
 * a room, and Ask's songs for the room. Each is lent from your bucket, so a
 * song not stored there yet is left out.
 */
export async function addSongsToRoom(songIds: readonly number[], title: string): Promise<void> {
  const songs = songIds.flatMap(id => {
    const song = cloudLibrary.cloudRoomSongNow(id)
    return song ? [song] : []
  })
  if (songs.length === 0) {
    showToast('None of those songs are in your storage yet', 'warn')
    return
  }
  try {
    for (const song of songs) await roomAct({ type: 'add', song })
    showToast(
      {
        over: `Added to ${title}`,
        say:
          songs.length === 1 && songs[0] ? songs[0].title : plural(songs.length, 'song', 'songs'),
      },
      'good',
    )
  } catch (error) {
    sayRoomFailure(error)
  }
}
