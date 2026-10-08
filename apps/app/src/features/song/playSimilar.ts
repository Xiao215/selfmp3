import { clientApi, failureText } from '@selfmp3/client'
import type { Song } from '@selfmp3/shared'
import type { PlayerApi } from '../../player/PlayerProvider'
import { showToast } from '../../ui/toast'

/**
 * "Play similar songs": the song's nearest neighbours from the server, with
 * the song itself leading the list, and Up next named for it. The song's menu
 * and Up next's "Songs like this" are the same press.
 */
export function playSimilar(
  player: Pick<PlayerApi, 'playFrom'>,
  song: Pick<Song, 'id' | 'title'>,
): void {
  void clientApi()
    .similar(song.id, 20)
    .then(result =>
      player.playFrom([song.id, ...result.songs.map(item => item.id)], 0, {
        source: { kind: 'songs', origin: 'similar', name: `Similar to ${song.title}` },
      }),
    )
    .catch((caught: unknown) =>
      showToast(failureText('Couldn’t find similar songs', caught), 'error'),
    )
}
