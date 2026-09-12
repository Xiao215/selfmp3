import type { RefObject } from 'react'
import type { Song, Tag } from '@selfmp3/shared'
import { usePlayer } from '../player/PlayerProvider.js'
import { SongMenu } from './SongMenu.js'

/**
 * The ⋯ menu for a song row, with the player attached.
 *
 * This exists so `SongRow` does not have to read the player context itself.
 * That context carries the playhead, so its value changes several times a
 * second while anything is playing — and a context change goes through `memo`,
 * which meant every row on screen re-rendered on every tick for the sake of two
 * callbacks that are only ever reached through a menu that is usually shut.
 * Mounted only while the menu is open, this pays that cost once, for one row.
 */
export function SongRowMenu({
  anchorRef,
  song,
  tagById,
  onClose,
  onStartSelecting,
}: {
  anchorRef: RefObject<HTMLButtonElement | null>
  song: Song
  tagById: ReadonlyMap<number, Tag>
  onClose: () => void
  onStartSelecting?: (() => void) | undefined
}) {
  const player = usePlayer()

  return (
    <SongMenu
      anchorRef={anchorRef}
      song={song}
      tagById={tagById}
      onClose={onClose}
      onPlayNext={() => player.playNext([song])}
      onAddToQueue={() => player.addToQueue([song])}
      onStartSelecting={onStartSelecting}
    />
  )
}
