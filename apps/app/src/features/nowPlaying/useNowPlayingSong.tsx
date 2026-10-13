import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useRouter } from 'expo-router'
import type { Song } from '@selfmp3/shared'
import { usePlayer } from '../../player/PlayerProvider'
import { RemoveSongs } from '../../ui/components/ConfirmRemoveSongs'
import { putAway } from './leaveNowPlaying'

/**
 * The song Now Playing is the page of, and removing it, for the phone's page
 * and the computer's stage alike.
 *
 * Removing is asked here, above the page, rather than in it: removing the song
 * playing moves the player on (`forgetSongs`), and with nothing after it there
 * is no page left for the dialog to be in before the server has answered. The
 * stage's dialog was its own, and went with it mid-request — the "Deleted …"
 * toast and any error with it — and the page sat on "Nothing playing". Each
 * layout draws `removeDialog` beside whichever page it shows, so the dialog is
 * the same element whether the song's page or the empty one is under it: a
 * different element remounted, never heard the server answer, and stayed up
 * asking again.
 *
 * And when the song playing goes — removed here with nothing after it, or the
 * queue cleared — there is nothing left to be the page of: it puts itself away
 * rather than staying up to say "Nothing playing" (Xiao, 2026-10-04). A page
 * opened with nothing playing in the first place still says so. Not before the
 * dialog has closed: its "Deleted …" comes when the server answers.
 */
export function useNowPlayingSong(): {
  song: Song | null
  /** What the page's song menu removes with (`SongMenu`'s `onRemove`). */
  onRemove: (song: Song) => void
  removeDialog: ReactNode
} {
  const router = useRouter()
  const song = usePlayer().current
  const [removing, setRemoving] = useState<Song | null>(null)
  const hadSong = useRef(song !== null)
  useEffect(() => {
    if (song !== null) hadSong.current = true
    else if (hadSong.current && removing === null) putAway(router)
  }, [song, removing, router])
  const removeDialog = removing ? (
    <RemoveSongs
      songs={[removing]}
      onCancel={() => setRemoving(null)}
      onDone={() => setRemoving(null)}
    />
  ) : null
  return { song, onRemove: setRemoving, removeDialog }
}
