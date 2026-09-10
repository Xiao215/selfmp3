import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EMPTY_SMART_RULES, formatLongDuration, type Playlist } from '@selfmp3/shared'
import { useCreatePlaylist, useLibrary, useUpdatePlaylist } from '../lib/queries.js'
import { usePlayer } from '../player/PlayerProvider.js'
import { api } from '../lib/api.js'
import { ListMusic, Play, Plus, Sparkles } from '../components/Icons.js'
import { GemsPlaylistCard } from '../components/GemsRow.js'

/**
 * Playlist index.
 *
 * Two kinds sit side by side: manual lists you curate, and smart lists that
 * build themselves from rules and stay correct as the library grows. The
 * distinction is visible at a glance rather than buried in a submenu.
 */
export function PlaylistsView() {
  const { data: library } = useLibrary()
  const navigate = useNavigate()
  const player = usePlayer()
  const createPlaylist = useCreatePlaylist()
  const updatePlaylist = useUpdatePlaylist()
  const [creating, setCreating] = useState<'manual' | 'smart' | null>(null)
  const [name, setName] = useState('')

  const playlists = library?.playlists ?? []
  const songById = new Map((library?.songs ?? []).map(song => [song.id, song]))

  const create = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || !creating) return

    const created = await createPlaylist.mutateAsync({
      name: trimmed,
      description: '',
      kind: creating,
      rules: creating === 'smart' ? EMPTY_SMART_RULES : null,
    })

    setName('')
    setCreating(null)
    void navigate(`/playlists/${created.id}`)
  }

  /** Resolve a playlist and start it, without navigating away. */
  const playNow = async (playlist: Playlist): Promise<void> => {
    const { songIds } = await api.playlistSongs(playlist.id)
    const songs = songIds.map(id => songById.get(id)).filter(song => song !== undefined)
    if (songs.length > 0) player.playFrom(songs, 0)
  }

  return (
    <section className="view">
      <header className="view-head">
        <div className="view-titles">
          <h1>Playlists</h1>
          <p className="view-sub">{playlists.length} playlists</p>
        </div>

        <div className="view-actions">
          <button
            type="button"
            className="button"
            onClick={() => setCreating(current => (current === 'manual' ? null : 'manual'))}
          >
            <Plus size={15} /> New playlist
          </button>
          <button
            type="button"
            className="button button-primary"
            onClick={() => setCreating(current => (current === 'smart' ? null : 'smart'))}
          >
            <Sparkles size={15} /> New smart playlist
          </button>
        </div>
      </header>

      {creating && (
        <form className="inline-form" onSubmit={event => void create(event)}>
          <input
            autoFocus
            value={name}
            onChange={event => setName(event.target.value)}
            placeholder={creating === 'smart' ? 'e.g. Chill, most played' : 'Playlist name'}
            spellCheck={false}
          />
          <button type="submit" className="button button-primary" disabled={!name.trim()}>
            Create
          </button>
          <button
            type="button"
            className="button"
            onClick={() => {
              setCreating(null)
              setName('')
            }}
          >
            Cancel
          </button>
        </form>
      )}

      <div className="playlist-grid">
        {/* Built in, and not a database row: nothing to delete or rename. */}
        <GemsPlaylistCard />

        {playlists.map(playlist => (
            <div key={playlist.id} className="playlist-card">
              <button
                type="button"
                className="playlist-card-main"
                onClick={() => void navigate(`/playlists/${playlist.id}`)}
              >
                <span className="playlist-card-icon">
                  {playlist.kind === 'smart' ? <Sparkles size={22} /> : <ListMusic size={22} />}
                </span>
                <span className="playlist-card-name">{playlist.name}</span>
                <span className="playlist-card-sub">
                  {playlist.songCount} songs · {formatLongDuration(playlist.totalDuration)}
                </span>
                {playlist.description && (
                  <span className="playlist-card-desc">{playlist.description}</span>
                )}
              </button>

              <div className="playlist-card-actions">
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => void playNow(playlist)}
                  aria-label={`Play ${playlist.name}`}
                  disabled={playlist.songCount === 0}
                >
                  <Play size={16} />
                </button>
                <button
                  type="button"
                  className={`icon-button ${playlist.pinned ? 'is-accent' : ''}`}
                  onClick={() =>
                    updatePlaylist.mutate({
                      id: playlist.id,
                      patch: { pinned: !playlist.pinned },
                    })
                  }
                  aria-label={playlist.pinned ? 'Unpin' : 'Pin to sidebar'}
                  title={playlist.pinned ? 'Unpin' : 'Pin to sidebar'}
                >
                  ★
                </button>
              </div>
            </div>
          ))}
      </div>

      {/* Below the grid, because the built-in card is already up there and an
          empty state above it would be contradicting itself. */}
      {playlists.length === 0 && (
        <div className="empty-state">
          <p className="empty-emoji">📼</p>
          <h2>No playlists of your own yet</h2>
          <p className="hint">
            A <strong>smart playlist</strong> is worth trying first — set a rule like &ldquo;tagged
            chill and played more than 5 times&rdquo; and it keeps itself up to date forever.
          </p>
        </div>
      )}
    </section>
  )
}
