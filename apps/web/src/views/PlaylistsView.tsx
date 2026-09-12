import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EMPTY_SMART_RULES, formatLongDuration, type Playlist } from '@selfmp3/shared'
import { useCreatePlaylist, useLibrary, useUpdatePlaylist } from '../lib/queries.js'
import { showToast } from '../components/Toast.js'
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
 *
 * The empty state is a card in the grid rather than a block underneath it,
 * because the built-in "forgotten gems" card is already up there — an empty
 * state below a populated grid reads as a contradiction.
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
    // Enter twice before the first one comes back would otherwise make two
    // playlists of the same name, and navigate to the second.
    if (!trimmed || !creating || createPlaylist.isPending) return

    let created
    try {
      created = await createPlaylist.mutateAsync({
        name: trimmed,
        description: '',
        kind: creating,
        rules: creating === 'smart' ? EMPTY_SMART_RULES : null,
      })
    } catch (error) {
      // The name stays in the box, so trying again is one keystroke.
      showToast(`Couldn’t create “${trimmed}”: ${(error as Error).message}`, 'error')
      return
    }

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
          <p className="view-sub">
            {playlists.length === 0
              ? 'None of your own yet'
              : `${playlists.length} ${playlists.length === 1 ? 'playlist' : 'playlists'}`}
          </p>
        </div>

        <div className="view-actions">
          <button
            type="button"
            className="button"
            aria-expanded={creating === 'manual'}
            onClick={() => setCreating(current => (current === 'manual' ? null : 'manual'))}
          >
            <Plus size={15} /> New playlist
          </button>
          <button
            type="button"
            className="button button-primary"
            aria-expanded={creating === 'smart'}
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
            aria-label={creating === 'smart' ? 'Smart playlist name' : 'Playlist name'}
            spellCheck={false}
          />
          <button
            type="submit"
            className="button button-primary"
            disabled={!name.trim() || createPlaylist.isPending}
          >
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
                {playlist.songCount} {playlist.songCount === 1 ? 'song' : 'songs'} ·{' '}
                {formatLongDuration(playlist.totalDuration)}
                {playlist.kind === 'smart' && ' · updates itself'}
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
                data-tip="Play"
                disabled={playlist.songCount === 0}
              >
                <Play size={16} />
              </button>
              <button
                type="button"
                className={`icon-button playlist-pin ${playlist.pinned ? 'is-accent' : ''}`}
                onClick={() =>
                  updatePlaylist.mutate({
                    id: playlist.id,
                    patch: { pinned: !playlist.pinned },
                  })
                }
                aria-pressed={playlist.pinned}
                aria-label={`Pin ${playlist.name} to the sidebar`}
                data-tip={playlist.pinned ? 'Unpin from the sidebar' : 'Pin to the sidebar'}
              >
                <span aria-hidden="true">★</span>
              </button>
            </div>
          </div>
        ))}

        {/*
         * The empty state is a cell of the grid, so it lines up beside the
         * built-in card instead of arguing with it.
         */}
        {playlists.length === 0 && (
          <div className="playlist-card playlist-card-empty">
            <p className="playlist-empty-title">Nothing of your own yet</p>
            <p className="hint">
              A <strong>smart playlist</strong> is worth trying first — set a rule like
              &ldquo;tagged chill and played more than 5 times&rdquo; and it keeps itself up to date
              forever.
            </p>
            <button
              type="button"
              className="button button-primary"
              onClick={() => setCreating('smart')}
            >
              <Sparkles size={15} /> New smart playlist
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
