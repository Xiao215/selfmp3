import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { fuzzyRank, type Library } from '@selfmp3/shared'
import { useCreateTag, useDeleteTag, useScanLibrary } from '../lib/queries.js'
import { useOffline } from '../offline/OfflineProvider.js'
import {
  BarChart,
  CloudDownload,
  Download,
  ListMusic,
  Music,
  Plus,
  Refresh,
  Settings,
  Sparkles,
  WifiOff,
  X,
} from './Icons.js'

/**
 * Desktop navigation.
 *
 * Tags live here rather than in a settings screen because tag filtering is the
 * main way this library is browsed — it replaces folders, genres and ratings
 * with one flat vocabulary you define.
 */
export function Sidebar({
  library,
  selectedTags,
  onToggleTag,
  onClearTags,
}: {
  library: Library | undefined
  selectedTags: ReadonlySet<number>
  onToggleTag: (tagId: number) => void
  onClearTags: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const navigate = useNavigate()

  const createTag = useCreateTag()
  const deleteTag = useDeleteTag()
  const scan = useScanLibrary()
  const offline = useOffline()

  const tags = library?.tags ?? []
  const playlists = library?.playlists ?? []
  const pinned = playlists.filter(list => list.pinned)

  const suggestions = name.trim() ? fuzzyRank(name, tags, tag => tag.name).slice(0, 3) : []
  const exact = suggestions.find(match => match.exact)

  const submitTag = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setAdding(false)
      return
    }

    // Selecting the existing tag beats silently creating a near-duplicate.
    if (exact) {
      if (!selectedTags.has(exact.item.id)) onToggleTag(exact.item.id)
    } else {
      await createTag.mutateAsync(trimmed).catch(() => undefined)
    }

    setName('')
    setAdding(false)
  }

  return (
    <nav className="sidebar" aria-label="Main navigation">
      <div className="brand">
        self<span className="brand-dot">.</span>mp3
      </div>

      {!offline.serverReachable && (
        <div className="offline-banner" role="status">
          <WifiOff size={15} />
          <span>Offline — playing downloaded music</span>
        </div>
      )}

      <div className="nav-group">
        <NavLink to="/" end className="nav-item" onClick={onClearTags}>
          <Music size={17} /> Library
        </NavLink>
        <NavLink to="/playlists" className="nav-item">
          <ListMusic size={17} /> Playlists
        </NavLink>
        <NavLink to="/import" className="nav-item">
          <Download size={17} /> Import
        </NavLink>
        <NavLink to="/stats" className="nav-item">
          <BarChart size={17} /> Stats
        </NavLink>
        <NavLink to="/settings" className="nav-item">
          <Settings size={17} /> Settings
        </NavLink>
      </div>

      {pinned.length > 0 && (
        <div className="nav-group">
          <div className="nav-group-title">Pinned</div>
          {pinned.map(list => (
            <button
              key={list.id}
              type="button"
              className="nav-item nav-item-small"
              onClick={() => void navigate(`/playlists/${list.id}`)}
            >
              {list.kind === 'smart' ? <Sparkles size={15} /> : <ListMusic size={15} />}
              <span className="nav-item-label">{list.name}</span>
              <span className="nav-item-count">{list.songCount}</span>
            </button>
          ))}
        </div>
      )}

      <div className="nav-group nav-group-grow">
        <div className="nav-group-title">
          <span>Tags</span>
          <div className="nav-group-actions">
            {selectedTags.size > 0 && (
              <button
                type="button"
                className="icon-button icon-button-tiny"
                onClick={onClearTags}
                aria-label="Clear tag filters"
                title="Clear filters"
              >
                <X size={13} />
              </button>
            )}
            <button
              type="button"
              className="icon-button icon-button-tiny"
              onClick={() => setAdding(open => !open)}
              aria-label="New tag"
              title="New tag"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>

        {adding && (
          <form className="tag-form" onSubmit={event => void submitTag(event)}>
            <input
              autoFocus
              value={name}
              onChange={event => setName(event.target.value)}
              placeholder="tag name"
              spellCheck={false}
              onBlur={() => {
                if (!name) setAdding(false)
              }}
            />
            {suggestions.length > 0 && (
              <div className="tag-suggestions">
                <span className="hint">{exact ? 'already exists:' : 'similar:'}</span>
                {suggestions.map(({ item }) => (
                  <button
                    key={item.id}
                    type="button"
                    className="tag-suggestion"
                    onClick={() => {
                      if (!selectedTags.has(item.id)) onToggleTag(item.id)
                      setName('')
                      setAdding(false)
                    }}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            )}
          </form>
        )}

        <div className="tag-list">
          {tags.map(tag => (
            <div
              key={tag.id}
              className={`tag-row ${selectedTags.has(tag.id) ? 'is-active' : ''}`}
              style={{ '--tag-hue': tag.hue } as React.CSSProperties}
            >
              <button type="button" className="tag-row-main" onClick={() => onToggleTag(tag.id)}>
                <span className="tag-dot" />
                <span className="tag-row-name">{tag.name}</span>
                <span className="tag-row-count">{tag.songCount}</span>
              </button>
              <button
                type="button"
                className="tag-row-delete"
                onClick={() => {
                  if (window.confirm(`Delete the tag "${tag.name}"? Your songs are kept.`)) {
                    if (selectedTags.has(tag.id)) onToggleTag(tag.id)
                    deleteTag.mutate(tag.id)
                  }
                }}
                aria-label={`Delete tag ${tag.name}`}
              >
                <X size={13} />
              </button>
            </div>
          ))}

          {tags.length === 0 && !adding && (
            <p className="hint">No tags yet. Tags are how you find things later — try “chill”.</p>
          )}
        </div>
      </div>

      <div className="sidebar-foot">
        {offline.sync.status === 'syncing' && (
          <div className="sync-mini">
            <span className="spinner" />
            <span className="hint">
              Downloading {offline.sync.progress.done}/{offline.sync.progress.total}
            </span>
          </div>
        )}

        <button
          type="button"
          className="nav-item nav-item-small"
          onClick={() => void navigate('/settings#offline')}
        >
          <CloudDownload size={15} />
          <span className="nav-item-label">Offline</span>
          <span className="nav-item-count">{offline.cachedIds.size}</span>
        </button>

        <button
          type="button"
          className="nav-item nav-item-small"
          onClick={() => scan.mutate()}
          disabled={scan.isPending}
        >
          <Refresh size={15} />
          <span className="nav-item-label">
            {scan.isPending ? 'Scanning…' : 'Rescan library'}
          </span>
        </button>
      </div>
    </nav>
  )
}
