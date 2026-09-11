import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { formatDuration, formatLongDuration, type SmartRules } from '@selfmp3/shared'
import {
  queryKeys,
  useDeletePlaylist,
  useLibrary,
  usePlaylistSongIds,
  useRemoveFromPlaylist,
  useUpdatePlaylist,
} from '../lib/queries.js'
import { usePlayer } from '../player/PlayerProvider.js'
import { useDragReorder } from '../lib/hooks.js'
import { useSelection } from '../lib/selection.js'
import { api } from '../lib/api.js'
import { SmartRuleBuilder } from '../components/SmartRuleBuilder.js'
import { SelectionBar } from '../components/SelectionBar.js'
import { Cover } from '../components/Cover.js'
import {
  Check,
  CheckSquare,
  Grip,
  Play,
  Shuffle,
  Sparkles,
  Trash,
  X,
} from '../components/Icons.js'

/**
 * One playlist.
 *
 * Manual playlists are drag-reorderable; smart playlists show their rule
 * builder instead, since their order comes from the rules.
 *
 * Reordering is available from the keyboard as well as the mouse: the grip is
 * a real button, and ↑/↓ on it move the track. A drag affordance that only
 * exists under a pointer is not an affordance on a phone or with a keyboard.
 */
export function PlaylistDetailView() {
  const { id } = useParams<{ id: string }>()
  const playlistId = Number(id)
  const navigate = useNavigate()

  const { data: library } = useLibrary()
  const { data: contents } = usePlaylistSongIds(Number.isInteger(playlistId) ? playlistId : null)
  const player = usePlayer()
  const queryClient = useQueryClient()

  const updatePlaylist = useUpdatePlaylist()
  const deletePlaylist = useDeletePlaylist()
  const removeFromPlaylist = useRemoveFromPlaylist()

  const [editingRules, setEditingRules] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState('')

  const playlist = library?.playlists.find(item => item.id === playlistId)
  const songById = useMemo(
    () => new Map((library?.songs ?? []).map(song => [song.id, song])),
    [library],
  )

  const songs = useMemo(
    () =>
      (contents?.songIds ?? [])
        .map(songId => songById.get(songId))
        .filter(song => song !== undefined),
    [contents, songById],
  )

  /**
   * Move a track and show it moved.
   *
   * The server is told the whole new order, but the cached list is updated
   * first — without that the row snaps back to where it was until the query
   * happens to refetch, which makes a successful drag look like a failed one.
   */
  const moveTo = (from: number, to: number): void => {
    const ids = songs.map(song => song.id)
    const [moved] = ids.splice(from, 1)
    if (moved === undefined) return
    ids.splice(to, 0, moved)
    queryClient.setQueryData(queryKeys.playlistSongs(playlistId), {
      playlistId,
      songIds: ids,
    })
    void api.reorderPlaylist(playlistId, ids)
  }

  const reorder = useDragReorder(moveTo)

  // The same selection the library has, so the two lists cannot disagree about
  // what a shift-click or Escape means. The extra batch action here is the one
  // that only makes sense in a playlist: taking songs out of it without
  // touching the library.
  const visibleIds = useMemo(() => songs.map(song => song.id), [songs])
  const selection = useSelection(visibleIds)
  const selectedSongs = useMemo(
    () => songs.filter(song => selection.has(song.id)),
    [songs, selection],
  )

  if (!playlist) {
    return (
      <section className="view">
        <div className="empty-state">
          <h2>Playlist not found</h2>
          <button type="button" className="button" onClick={() => void navigate('/playlists')}>
            Back to playlists
          </button>
        </div>
      </section>
    )
  }

  const totalSeconds = songs.reduce((sum, song) => sum + song.duration, 0)
  const manual = playlist.kind === 'manual'

  const saveRules = (rules: SmartRules): void => {
    updatePlaylist.mutate({ id: playlist.id, patch: { rules } })
  }

  const startRenaming = (): void => {
    setDraftName(playlist.name)
    setRenaming(true)
  }

  const saveName = (event: React.FormEvent): void => {
    event.preventDefault()
    const trimmed = draftName.trim()
    if (trimmed && trimmed !== playlist.name) {
      updatePlaylist.mutate({ id: playlist.id, patch: { name: trimmed } })
    }
    setRenaming(false)
  }

  return (
    <section className="view">
      <header className="view-head">
        <div className="view-titles">
          {renaming ? (
            <form onSubmit={saveName} className="inline-form">
              <input
                autoFocus
                value={draftName}
                aria-label="Playlist name"
                onChange={event => setDraftName(event.target.value)}
                onBlur={() => setRenaming(false)}
              />
            </form>
          ) : (
            <h1 className="playlist-title" onDoubleClick={startRenaming}>
              {playlist.kind === 'smart' && <Sparkles size={20} />} {playlist.name}
              <button
                type="button"
                className="icon-button icon-button-tiny playlist-rename"
                onClick={startRenaming}
                aria-label={`Rename ${playlist.name}`}
                data-tip="Rename"
              >
                <Pencil size={13} />
              </button>
            </h1>
          )}
          <p className="view-sub">
            {songs.length} {songs.length === 1 ? 'song' : 'songs'} ·{' '}
            {formatLongDuration(totalSeconds)}
            {playlist.kind === 'smart'
              ? ' · updates itself'
              : // The handles step aside in selection mode, so the hint has to
                // as well rather than pointing at something that is not there.
                songs.length > 1 && !selection.active && ' · drag the handles to reorder'}
          </p>
        </div>

        <div className="view-actions">
          <button
            type="button"
            className={`button library-select ${selection.active ? 'is-active' : ''}`}
            onClick={() => (selection.active ? selection.clear() : selection.enter())}
            disabled={songs.length === 0}
            aria-pressed={selection.active}
            data-tip={
              selection.active ? 'Done selecting (Esc)' : 'Select songs to act on several at once'
            }
          >
            <CheckSquare size={15} />{' '}
            <span className="button-label">{selection.active ? 'Done' : 'Select'}</span>
          </button>

          <button
            type="button"
            className="button button-primary"
            onClick={() => songs.length > 0 && player.playFrom(songs, 0)}
            disabled={songs.length === 0}
          >
            <Play size={15} /> Play
          </button>

          <button
            type="button"
            className="button"
            onClick={() => {
              if (songs.length === 0) return
              if (!player.queue.shuffle) player.toggleShuffle()
              player.playFrom(songs, Math.floor(Math.random() * songs.length))
            }}
            disabled={songs.length === 0}
          >
            <Shuffle size={15} /> Shuffle
          </button>

          {playlist.kind === 'smart' && (
            <button
              type="button"
              className="button"
              aria-expanded={editingRules}
              onClick={() => setEditingRules(open => !open)}
            >
              {editingRules ? 'Done' : 'Edit rules'}
            </button>
          )}

          <button
            type="button"
            className="button button-danger"
            onClick={() => {
              if (window.confirm(`Delete the playlist "${playlist.name}"? Your songs are kept.`)) {
                deletePlaylist.mutate(playlist.id)
                void navigate('/playlists')
              }
            }}
            aria-label={`Delete the playlist ${playlist.name}`}
            data-tip="Delete playlist"
          >
            <Trash size={15} />
          </button>
        </div>
      </header>

      {playlist.kind === 'smart' && editingRules && (
        <SmartRuleBuilder
          rules={playlist.rules ?? undefined}
          tags={library?.tags ?? []}
          onChange={saveRules}
        />
      )}

      {selection.active && (
        <SelectionBar
          songs={selectedSongs}
          total={songs.length}
          scope="in this playlist"
          allSelected={selection.allSelected}
          onSelectAll={selection.selectAll}
          onDeselectAll={selection.deselectAll}
          onDone={selection.clear}
          // A smart playlist has no membership to edit — it builds itself from
          // its rules, so "remove from this playlist" would be a lie.
          playlist={manual ? { id: playlist.id, name: playlist.name } : undefined}
        />
      )}

      {songs.length === 0 ? (
        <div className="empty-state">
          <p className="empty-emoji">{playlist.kind === 'smart' ? '✨' : '📼'}</p>
          <h2>Nothing here yet</h2>
          <p className="hint">
            {playlist.kind === 'smart'
              ? 'No songs match these rules yet. Try loosening them — the count above the rules updates as you type.'
              : 'Add songs from the library using the ⋯ menu on any track.'}
          </p>
          {!(playlist.kind === 'smart' && editingRules) && (
            <div className="button-row empty-actions">
              <button
                type="button"
                className="button"
                onClick={() =>
                  playlist.kind === 'smart' ? setEditingRules(true) : void navigate('/')
                }
              >
                {playlist.kind === 'smart' ? 'Edit the rules' : 'Go to the library'}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div
          className={[
            'song-list playlist-song-list',
            reorder.dragging !== null ? 'is-reordering' : '',
            selection.active ? 'is-selecting' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onPointerUp={reorder.end}
          onPointerCancel={reorder.end}
          onKeyDown={event => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
              event.preventDefault()
              event.stopPropagation()
              selection.selectAll()
            }
          }}
        >
          {songs.map((song, index) => (
            <div
              key={song.id}
              className={[
                'playlist-row',
                player.current?.id === song.id ? 'is-current' : '',
                selection.has(song.id) ? 'is-selected' : '',
                reorder.dragging === index ? 'is-dragging' : '',
                reorder.over === index && reorder.dragging !== null && reorder.dragging !== index
                  ? 'is-drop-target'
                  : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onPointerEnter={() => reorder.enter(index)}
            >
              <div className="playlist-row-select">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={selection.has(song.id)}
                  className="song-select-box"
                  onClick={() => selection.toggle(song.id)}
                  aria-label={
                    selection.has(song.id) ? `Deselect ${song.title}` : `Select ${song.title}`
                  }
                >
                  <span
                    className={`checkbox ${selection.has(song.id) ? 'is-on' : ''}`}
                    aria-hidden="true"
                  >
                    {selection.has(song.id) && <Check size={12} />}
                  </span>
                </button>
              </div>

              {manual && (
                <button
                  type="button"
                  className="queue-grip playlist-grip"
                  onPointerDown={event => reorder.start(index, event)}
                  onKeyDown={event => {
                    if (event.key === 'ArrowUp' && index > 0) {
                      event.preventDefault()
                      moveTo(index, index - 1)
                    } else if (event.key === 'ArrowDown' && index < songs.length - 1) {
                      event.preventDefault()
                      moveTo(index, index + 1)
                    }
                  }}
                  aria-label={`Move ${song.title}. Use the up and down arrow keys.`}
                  data-tip="Drag to reorder, or use ↑ and ↓"
                >
                  <Grip size={16} />
                </button>
              )}

              <button
                type="button"
                className="playlist-row-main"
                onMouseDown={event => {
                  // Stop a shift-click painting a text selection across rows.
                  if (event.shiftKey) event.preventDefault()
                }}
                onClick={event => {
                  // Cmd, Shift and selection mode all mean "select"; anything
                  // else still means "play from here".
                  if (selection.click(song.id, event)) return
                  player.playFrom(songs, index)
                }}
              >
                <span className="playlist-row-index">{index + 1}</span>
                <Cover song={song} size={36} />
                <span className="playlist-row-meta">
                  <span className="playlist-row-title">{song.title}</span>
                  <span className="playlist-row-artist">{song.artist || 'Unknown artist'}</span>
                </span>
              </button>

              <span className="playlist-row-time">{formatDuration(song.duration)}</span>

              {manual && (
                <button
                  type="button"
                  className="icon-button playlist-row-remove"
                  onClick={() =>
                    removeFromPlaylist.mutate({ playlistId: playlist.id, songId: song.id })
                  }
                  aria-label={`Remove ${song.title} from ${playlist.name}`}
                  data-tip="Remove from this playlist"
                >
                  <X size={15} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/** A pencil, for the rename affordance the double-click alone did not give. */
function Pencil({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}
