import { useState } from 'react'
import type { Song } from '@selfmp3/shared'
import { useAddToPlaylist, useDeleteSong, useLibrary } from '../lib/queries.js'
import { useOffline } from '../offline/OfflineProvider.js'
import { useClickOutside } from '../lib/hooks.js'
import { CloudDownload, ListMusic, Queue, Trash, X } from './Icons.js'

/**
 * The per-song action menu.
 *
 * Destructive actions are separated visually and the file-deleting one asks
 * for confirmation — "remove from library" and "delete the actual file" are
 * very different intentions and must never be one mis-tap apart.
 */
export function SongMenu({
  song,
  onClose,
  onPlayNext,
  onAddToQueue,
}: {
  song: Song
  onClose: () => void
  onPlayNext: () => void
  onAddToQueue: () => void
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [playlistOpen, setPlaylistOpen] = useState(false)

  const { data: library } = useLibrary()
  const addToPlaylist = useAddToPlaylist()
  const deleteSong = useDeleteSong()
  const offline = useOffline()

  const ref = useClickOutside<HTMLDivElement>(onClose)
  const cached = offline.isCached(song.id)

  const manualPlaylists = (library?.playlists ?? []).filter(list => list.kind === 'manual')

  const act = (fn: () => void): void => {
    fn()
    onClose()
  }

  return (
    <>
      <div className="popover-backdrop" onClick={onClose} />
      <div className="popover song-menu" ref={ref} role="menu">
        <button type="button" className="popover-item" onClick={() => act(onPlayNext)}>
          <Queue size={15} /> Play next
        </button>

        <button type="button" className="popover-item" onClick={() => act(onAddToQueue)}>
          <ListMusic size={15} /> Add to queue
        </button>

        <button
          type="button"
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
          className="popover-item"
          onClick={() =>
            act(() => {
              void (cached ? offline.removeOne(song.id) : offline.downloadOne(song.id))
            })
          }
        >
          {cached ? <X size={15} /> : <CloudDownload size={15} />}
          {cached ? 'Remove download' : 'Download for offline'}
        </button>

        <div className="popover-divider" />

        {!confirmingDelete ? (
          <button
            type="button"
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
              className="popover-item"
              onClick={() => act(() => deleteSong.mutate({ id: song.id, deleteFile: false }))}
            >
              Remove from library, keep the file
            </button>
            <button
              type="button"
              className="popover-item is-danger"
              onClick={() => act(() => deleteSong.mutate({ id: song.id, deleteFile: true }))}
            >
              <Trash size={15} /> Delete the file too
            </button>
            <button
              type="button"
              className="popover-item"
              onClick={() => setConfirmingDelete(false)}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </>
  )
}
