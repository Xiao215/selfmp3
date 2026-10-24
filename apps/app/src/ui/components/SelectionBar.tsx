import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { View } from 'react-native'
import { artistOr } from '@selfmp3/shared'
import type { Song } from '@selfmp3/shared'
import { usePlaylistRemoval } from '../../features/playlists/usePlaylistRemoval'
import { useFlyToUpNext } from '../../features/queue/useFlyToUpNext'
import { usePlayerCommands } from '../../player/PlayerProvider'
import { useLayoutValue } from '../../shell/useLayout'
import { SONG_ACTION_LABELS } from '../songActions.model'
import { RemoveSongs } from './ConfirmRemoveSongs'
import { Play, QueueAdd, X } from './Icons'
import { SelectionLane, type BarAction } from './SelectionLane'
import { SelectionTagPicker } from './TagPicker'
import { SongActionItems } from './SongActionItems'

export { SELECTION_BAR_SPACE, selectionBarLift } from './SelectionLane'

/** What Up next is called when the ticked songs are played: they can be saved from there. */
const PICKED = { kind: 'songs', origin: 'selection', name: 'Songs you picked' } as const

const SONG_NOUN = { one: 'song', many: 'songs' } as const

/**
 * The bar that runs a multi-selection of songs: the lane every selection has
 * (`SelectionLane`), with what is done to songs in it.
 *
 * Play and Add to Up next are in the bar because they are harmless and
 * frequent: drawn as labelled buttons on a computer and as icons on a phone,
 * where Play is the filled one. A computer has room for a playlist's Remove
 * beside them; a phone keeps it in More. Everything that edits the library
 * sits behind More — a popover at desktop width, a sheet on a phone — and is
 * the song menu's own items for many songs (`SongActionItems`), with "Delete
 * from library" last and in red, and behind a confirmation.
 */
export function SelectionBar({
  songs,
  total,
  narrowed = false,
  scope,
  allSelected,
  onSelectAll,
  onDeselectAll,
  onDone,
  playlist,
  shown,
  inline = false,
}: {
  /** The selected songs, in the order the list has them. */
  songs: readonly Song[]
  /** How many rows the list is showing right now. */
  total: number
  /** A search or filter is narrowing the list. */
  narrowed?: boolean
  /** What "all" means here, in words: "in this view", "in your library". */
  scope: string
  allSelected: boolean
  onSelectAll: () => void
  onDeselectAll: () => void
  onDone: () => void
  /** Set in a playlist, which offers removing from it without deleting. */
  playlist?: { readonly id: number; readonly name: string }
  /** See `SelectionLane`. */
  shown: boolean
  /** See `SelectionLane`. */
  inline?: boolean
}): ReactNode {
  const wide = useLayoutValue(layout => layout.wide)
  const player = usePlayerCommands()
  const fly = useFlyToUpNext()
  const removeFromPlaylist = usePlaylistRemoval()
  // The tag picker, opened from More as a song's is from its menu.
  const [tagging, setTagging] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const moreRef = useRef<View>(null)

  const count = songs.length
  // A selection emptied under the picker — a tag filter dropping the songs it
  // just untagged — takes the picker with it, rather than leave it over none.
  if (tagging && count === 0) setTagging(false)
  const ids = songs.map(song => song.id)

  const actions: readonly BarAction[] = [
    {
      key: 'play',
      label: 'Play',
      Glyph: Play,
      filled: true,
      onPress: () => player.playFrom(ids, 0, { source: PICKED }),
    },
    {
      key: 'queue',
      label: SONG_ACTION_LABELS.addToUpNext,
      Glyph: QueueAdd,
      onPress: from => {
        fly(from, ids)
        player.addToQueue(ids)
      },
    },
    ...(playlist && wide
      ? [
          {
            key: 'remove',
            label: SONG_ACTION_LABELS.removeFromPlaylist,
            Glyph: X,
            onPress: () => removeFromPlaylist(playlist, songs),
          },
        ]
      : []),
  ]

  return (
    <>
      <SelectionLane
        count={count}
        total={total}
        noun={SONG_NOUN}
        narrowed={narrowed}
        scope={scope}
        allSelected={allSelected}
        onSelectAll={onSelectAll}
        onDeselectAll={onDeselectAll}
        onDone={onDone}
        shown={shown}
        inline={inline}
        actions={actions}
        moreRef={moreRef}
        summary={count > 0 ? summarise(songs) : null}
        menu={close => (
          // The song menu's items, for every song ticked: what the bar has
          // already is left out of them.
          <SongActionItems
            songs={songs}
            playlist={playlist}
            leave={wide ? ['addToUpNext', 'removeFromPlaylist'] : ['addToUpNext']}
            flyFrom={moreRef}
            onClose={close}
            onTags={() => setTagging(true)}
            onDelete={() => setConfirming(true)}
            onNewPlaylist={onDone}
          />
        )}
      />

      <SelectionTagPicker
        songs={songs}
        open={tagging}
        onClose={() => setTagging(false)}
        anchorRef={moreRef}
      />

      {confirming ? (
        <RemoveSongs
          songs={songs}
          onCancel={() => setConfirming(false)}
          onDone={() => {
            setConfirming(false)
            onDone()
          }}
        />
      ) : null}
    </>
  )
}

/** "Aurora Lane · Klara Feld and 2 more" — enough to recognise the selection. */
function summarise(songs: readonly Song[]): string {
  const artists = [...new Set(songs.map(song => artistOr(song.artist)))]
  if (artists.length <= 2) return artists.join(' · ')
  return `${artists.slice(0, 2).join(' · ')} and ${artists.length - 2} more`
}
