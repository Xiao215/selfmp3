import type { ReactNode } from 'react'
import { formatBytes, type Song } from '@selfmp3/shared'
import { useToggleLoved } from '../../api/queries'
import { isDownloaded, colors } from '@selfmp3/client'
import { useDownloads } from '../../offline/DownloadsProvider'
import { usePlayer } from '../../player/PlayerProvider'
import { CheckSquare, CloudDownload, Heart, ListMusic, Queue, Trash } from './Icons'
import { Sheet, SheetItem } from './Sheet'

/**
 * The ⋯ menu for a song, as a sheet: the web's `SongMenu`, with the entries
 * a phone can act on. Tagging and playlists need a Mac's editor and stay
 * there; playing next, queueing, loving and keeping a copy on this phone do
 * not.
 *
 * Mounted only while open, the way the web's is, so the rows never pay for
 * the player context it reads.
 */
export function SongMenu({
  song,
  onClose,
  onStartSelecting,
}: {
  song: Song | null
  onClose: () => void
  /**
   * Where the list supports it, "Select" starts selection mode with this song
   * ticked — the web's third way in, and the only one a held finger has.
   */
  onStartSelecting?: (song: Song) => void
}): ReactNode {
  return (
    <Sheet
      testID="song-menu"
      open={song !== null}
      onClose={onClose}
      title={song?.title}
      subtitle={song ? song.artist || 'Unknown artist' : undefined}
    >
      {song ? <Items song={song} onClose={onClose} onStartSelecting={onStartSelecting} /> : null}
    </Sheet>
  )
}

function Items({
  song,
  onClose,
  onStartSelecting,
}: {
  song: Song
  onClose: () => void
  onStartSelecting?: (song: Song) => void
}): ReactNode {
  const player = usePlayer()
  const toggleLoved = useToggleLoved()
  const { state: downloads, queue: downloadQueue } = useDownloads()
  const held = isDownloaded(downloads.index, song.id)

  const then = (run: () => void) => (): void => {
    run()
    onClose()
  }

  return (
    <>
      <SheetItem
        icon={<Queue size={16} color={colors.textSecondary} />}
        label="Play next"
        onPress={then(() => player.playNext([song.id]))}
      />
      <SheetItem
        icon={<ListMusic size={16} color={colors.textSecondary} />}
        label="Add to queue"
        onPress={then(() => player.addToQueue([song.id]))}
      />
      <SheetItem
        icon={
          <Heart
            size={16}
            filled={song.loved}
            color={song.loved ? colors.danger : colors.textSecondary}
          />
        }
        label={song.loved ? 'Remove from loved' : 'Love this song'}
        onPress={then(() => toggleLoved.mutate({ id: song.id, loved: !song.loved }))}
      />
      {held ? (
        <SheetItem
          icon={<Trash size={16} color={colors.danger} />}
          label="Remove from this phone"
          danger
          onPress={then(() => void downloadQueue.remove([song.id]))}
        />
      ) : (
        <SheetItem
          icon={<CloudDownload size={16} color={colors.textSecondary} />}
          label="Keep on this phone"
          detail={song.sizeBytes > 0 ? formatBytes(song.sizeBytes) : undefined}
          onPress={then(() => downloadQueue.enqueue([song.id]))}
        />
      )}
      {onStartSelecting ? (
        <SheetItem
          icon={<CheckSquare size={16} color={colors.textSecondary} />}
          label="Select"
          onPress={then(() => onStartSelecting(song))}
        />
      ) : null}
    </>
  )
}
