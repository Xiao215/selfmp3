import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { formatLongDuration, type SmartRules } from '@selfmp3/shared'
import {
  useDeletePlaylist,
  useLibrary,
  usePlaylistSongIds,
  useRemoveFromPlaylist,
  useUpdatePlaylist,
} from '../lib/queries.js'
import { usePlayer } from '../player/PlayerProvider.js'
import { useDragReorder } from '../lib/hooks.js'
import { api } from '../lib/api.js'
import { SmartRuleBuilder } from '../components/SmartRuleBuilder.js'
import { Cover } from '../components/Cover.js'
import { Grip, Play, Shuffle, Sparkles, Trash, X } from '../components/Icons.js'

/**
 * One playlist.
 *
 * Manual playlists are drag-reorderable; smart playlists show their rule
 * builder instead, since their order comes from the rules.
 */
export function PlaylistDetailView() {
  const { id } = useParams<{ id: string }>()
  const playlistId = Number(id)
  const navigate = useNavigate()

  const { data: library } = useLibrary()
  const { data: contents } = usePlaylistSongIds(Number.isInteger(playlistId) ? playlistId : null)
  const player = usePlayer()

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

  const reorder = useDragReorder((from, to) => {
    const ids = songs.map(song => song.id)
    const [moved] = ids.splice(from, 1)
    if (moved === undefined) return
    ids.splice(to, 0, moved)
    void api.reorderPlaylist(playlistId, ids)
  })

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

  const saveRules = (rules: SmartRules): void => {
    updatePlaylist.mutate({ id: playlist.id, patch: { rules } })
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
                onChange={event => setDraftName(event.target.value)}
                onBlur={() => setRenaming(false)}
              />
            </form>
          ) : (
            <h1
              onDoubleClick={() => {
                setDraftName(playlist.name)
                setRenaming(true)
              }}
              title="Double-click to rename"
            >
              {playlist.kind === 'smart' && <Sparkles size={20} />} {playlist.name}
            </h1>
          )}
          <p className="view-sub">
            {songs.length} songs · {formatLongDuration(totalSeconds)}
            {playlist.kind === 'smart' && ' · updates itself'}
          </p>
        </div>

        <div className="view-actions">
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
            aria-label="Delete playlist"
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

      {songs.length === 0 ? (
        <div className="empty-state">
          <p className="empty-emoji">{playlist.kind === 'smart' ? '✨' : '📼'}</p>
          <h2>Nothing here yet</h2>
          <p className="hint">
            {playlist.kind === 'smart'
              ? 'No songs match these rules yet. Try loosening them.'
              : 'Add songs from the library using the ⋮ menu on any track.'}
          </p>
        </div>
      ) : (
        <div className="song-list" onPointerUp={reorder.end} onPointerCancel={reorder.end}>
          {songs.map((song, index) => (
            <div
              key={song.id}
              className={[
                'playlist-row',
                player.current?.id === song.id ? 'is-current' : '',
                reorder.dragging === index ? 'is-dragging' : '',
                reorder.over === index && reorder.dragging !== null && reorder.dragging !== index
                  ? 'is-drop-target'
                  : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onPointerEnter={() => reorder.enter(index)}
            >
              {playlist.kind === 'manual' && (
                <button
                  type="button"
                  className="queue-grip"
                  onPointerDown={event => reorder.start(index, event)}
                  aria-label={`Reorder ${song.title}`}
                >
                  <Grip size={16} />
                </button>
              )}

              <button
                type="button"
                className="playlist-row-main"
                onClick={() => player.playFrom(songs, index)}
              >
                <span className="playlist-row-index">{index + 1}</span>
                <Cover song={song} size={36} />
                <span className="playlist-row-meta">
                  <span className="playlist-row-title">{song.title}</span>
                  <span className="playlist-row-artist">{song.artist || 'Unknown artist'}</span>
                </span>
              </button>

              {playlist.kind === 'manual' && (
                <button
                  type="button"
                  className="icon-button"
                  onClick={() =>
                    removeFromPlaylist.mutate({ playlistId: playlist.id, songId: song.id })
                  }
                  aria-label={`Remove ${song.title} from playlist`}
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
