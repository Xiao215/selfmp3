import { useState } from 'react'
import type { Song, Tag } from '@selfmp3/shared'
import { useAddToPlaylist, useDeleteSong, useLibrary, usePatchSong } from '../lib/queries.js'
import { useOffline } from '../offline/OfflineProvider.js'
import { usePlayer } from '../player/PlayerProvider.js'
import { api } from '../lib/api.js'
import { fileManagerName, showInFileManager } from '../lib/fileManager.js'
import { showToast } from './Toast.js'
import {
  CheckSquare,
  CloudDownload,
  Folder,
  Info,
  ListMusic,
  Music,
  Queue,
  Sparkles,
  Tag as TagIcon,
  Trash,
  X,
} from './Icons.js'
import { MetadataDialog } from './MetadataDialog.js'
import { SongDetailsDialog } from './SongDetailsDialog.js'
import { TagPicker } from './TagPicker.js'
import { Popover } from './Menu.js'

/**
 * The per-song action menu.
 *
 * Destructive actions are separated visually and the file-deleting one asks
 * for confirmation — "remove from library" and "delete the actual file" are
 * very different intentions and must never be one mis-tap apart.
 *
 * At phone width this is the row's only set of actions — the tag column and
 * the hover controls are not there — so everything the row can do has to be
 * reachable from here, tagging included. It presents as a bottom sheet, with
 * the song's name at the top so a menu opened by holding a row still says
 * which row it came from.
 */
export function SongMenu({
  anchorRef,
  song,
  tagById,
  onClose,
  onPlayNext,
  onAddToQueue,
  onStartSelecting,
}: {
  anchorRef: React.RefObject<HTMLElement | null>
  song: Song
  tagById: ReadonlyMap<number, Tag>
  onClose: () => void
  onPlayNext: () => void
  onAddToQueue: () => void
  /**
   * Enter multi-select with this song picked. This is the phone's way in:
   * there are no modifier keys on a touch screen, so the menu you already
   * reach by holding a row is where "select several of these" has to live.
   */
  onStartSelecting?: () => void
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [playlistOpen, setPlaylistOpen] = useState(false)
  const [metadataOpen, setMetadataOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)

  const { data: library } = useLibrary()
  const addToPlaylist = useAddToPlaylist()
  const deleteSong = useDeleteSong()
  const patchSong = usePatchSong()
  const offline = useOffline()
  const player = usePlayer()

  const cached = offline.isCached(song.id)
  const onServerMachine = offline.holdsLibrary

  const manualPlaylists = (library?.playlists ?? []).filter(list => list.kind === 'manual')

  const act = (fn: () => void): void => {
    fn()
    onClose()
  }

  // A dialog replaces the menu rather than stacking on it: the menu's
  // click-outside handler would otherwise close both on the first click.
  if (metadataOpen) return <MetadataDialog song={song} onClose={onClose} />
  if (detailsOpen) return <SongDetailsDialog song={song} onClose={onClose} />
  if (tagsOpen) {
    return (
      <TagPicker
        anchorRef={anchorRef}
        song={song}
        allTags={[...tagById.values()]}
        onClose={onClose}
      />
    )
  }

  /** Nearest neighbours from the server; the seed song leads the list. */
  const withSimilar = (fn: (songs: Song[]) => void): void => {
    void api
      .similar(song.id, 20)
      .then(result => fn([song, ...result.songs]))
      .catch(() => undefined)
  }

  return (
    <Popover
      anchorRef={anchorRef}
      onClose={onClose}
      label="Song actions"
      className="song-menu"
      sheet
      roving
    >
      {/* Only shown once the menu is a sheet: on the desktop it hangs off the
          row it belongs to and does not need to name it. */}
      <div className="song-menu-head" aria-hidden="true">
        <span className="song-menu-head-title">{song.title}</span>
        <span className="song-menu-head-artist">{song.artist || 'Unknown artist'}</span>
      </div>

      {onStartSelecting && (
        <>
          <button
            type="button"
            role="menuitem"
            className="popover-item"
            onClick={() => act(onStartSelecting)}
          >
            <CheckSquare size={15} /> Select
          </button>

          <div className="popover-divider" />
        </>
      )}

      <button
        type="button"
        role="menuitem"
        className="popover-item"
        onClick={() => act(onPlayNext)}
      >
        <Queue size={15} /> Play next
      </button>

      <button
        type="button"
        role="menuitem"
        className="popover-item"
        onClick={() => act(onAddToQueue)}
      >
        <ListMusic size={15} /> Add to queue
      </button>

      <div className="popover-divider" />

      <button
        type="button"
        role="menuitem"
        className="popover-item"
        onClick={() => act(() => withSimilar(songs => player.playFrom(songs, 0)))}
      >
        <Sparkles size={15} /> Play similar
      </button>

      <button
        type="button"
        role="menuitem"
        className="popover-item"
        onClick={() => act(() => withSimilar(songs => player.addToQueue(songs.slice(1))))}
      >
        <Sparkles size={15} /> Add similar to queue
      </button>

      <div className="popover-divider" />

      <button
        type="button"
        role="menuitem"
        className="popover-item"
        onClick={() => setTagsOpen(true)}
      >
        <TagIcon size={15} /> Edit tags…
      </button>

      <button
        type="button"
        role="menuitem"
        className="popover-item"
        onClick={() => setPlaylistOpen(open => !open)}
        aria-expanded={playlistOpen}
      >
        <ListMusic size={15} /> Add to playlist…
      </button>

      {playlistOpen && (
        <div className="popover-nested">
          {manualPlaylists.length === 0 && <p className="hint">No playlists yet.</p>}
          {manualPlaylists.map(list => (
            <button
              key={list.id}
              type="button"
              role="menuitem"
              className="popover-item"
              onClick={() =>
                act(() => addToPlaylist.mutate({ playlistId: list.id, songIds: [song.id] }))
              }
            >
              {list.name}
            </button>
          ))}
        </div>
      )}

      <div className="popover-divider" />

      <button
        type="button"
        role="menuitem"
        className="popover-item"
        onClick={() => setDetailsOpen(true)}
      >
        <Info size={15} /> Song details
      </button>

      {/* On the Mac that runs self.mp3 the song is a real file in a real
          folder, and that is more use than a second copy in the browser. */}
      {onServerMachine && !song.missing && (
        <button
          type="button"
          role="menuitem"
          className="popover-item"
          onClick={() => act(() => showInFileManager(song.id))}
        >
          <Folder size={15} /> Show in {fileManagerName()}
        </button>
      )}

      <button
        type="button"
        role="menuitem"
        className="popover-item"
        onClick={() => setMetadataOpen(true)}
      >
        <Sparkles size={15} /> Fix metadata…
      </button>

      {/* An instrumental gets a visual instead of "no lyrics found", and is not
          looked up on lrclib again. Easy to take back: lyrics you add later win. */}
      <button
        type="button"
        role="menuitem"
        className="popover-item"
        onClick={() =>
          act(() => patchSong.mutate({ id: song.id, patch: { instrumental: !song.instrumental } }))
        }
      >
        <Music size={15} /> {song.instrumental ? 'Has lyrics after all' : 'Mark as instrumental'}
      </button>

      {/* Downloading is for devices away from the library. Where it lives,
          every song is already on this device, as a file. */}
      {!offline.holdsLibrary && (
        <button
          type="button"
          role="menuitem"
          className="popover-item"
          onClick={() =>
            act(() => {
              const change = cached ? offline.removeOne(song.id) : offline.downloadOne(song.id)
              change.catch(() =>
                showToast(
                  `Couldn’t download “${song.title}”. Is your Mac reachable?`,
                  'error',
                  5000,
                ),
              )
            })
          }
        >
          {cached ? <X size={15} /> : <CloudDownload size={15} />}
          {cached ? 'Remove download' : 'Download for offline'}
        </button>
      )}

      <div className="popover-divider" />

      {!confirmingDelete ? (
        <button
          type="button"
          role="menuitem"
          className="popover-item is-danger"
          onClick={() => setConfirmingDelete(true)}
        >
          <Trash size={15} /> Remove from library…
        </button>
      ) : (
        <div className="popover-confirm">
          <p className="hint">Remove &ldquo;{song.title}&rdquo;?</p>
          <button
            type="button"
            role="menuitem"
            className="popover-item"
            onClick={() => act(() => deleteSong.mutate({ id: song.id, deleteFile: false }))}
          >
            Remove from library, keep the file
          </button>
          <button
            type="button"
            role="menuitem"
            className="popover-item is-danger"
            onClick={() => act(() => deleteSong.mutate({ id: song.id, deleteFile: true }))}
          >
            <Trash size={15} /> Delete the file too
          </button>
          <button
            type="button"
            role="menuitem"
            className="popover-item"
            onClick={() => setConfirmingDelete(false)}
          >
            Cancel
          </button>
        </div>
      )}
    </Popover>
  )
}
