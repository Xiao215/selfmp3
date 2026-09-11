import { useRef, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { fuzzyRank, type Library, type Tag as TagType } from '@selfmp3/shared'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { queryKeys, useCreateTag, useScanLibrary } from '../lib/queries.js'
import { useOffline } from '../offline/OfflineProvider.js'
import { CLOUD } from '../lib/platform.js'
import { TagEditor, type TagFilterState } from './TagEditor.js'
import {
  BarChart,
  CloudDownload,
  Download,
  Inbox,
  ListMusic,
  Minus,
  More,
  Music,
  Plus,
  Refresh,
  Settings,
  Sparkles,
  Tag,
  WifiOff,
  X,
  BrandMark,
} from './Icons.js'

/**
 * Desktop navigation.
 *
 * Tags live here rather than in a settings screen because tag filtering is the
 * main way this library is browsed — it replaces folders, genres and ratings
 * with one flat vocabulary you define.
 */
export function Sidebar({
  inert,
  library,
  selectedTags,
  excludedTags,
  onToggleTag,
  onExcludeTag,
  onClearTags,
}: {
  /** While the song's page lies over it. */
  inert: boolean
  library: Library | undefined
  selectedTags: ReadonlySet<number>
  excludedTags: ReadonlySet<number>
  onToggleTag: (tagId: number) => void
  onExcludeTag: (tagId: number) => void
  onClearTags: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const navigate = useNavigate()

  const createTag = useCreateTag()
  const scan = useScanLibrary()
  const queryClient = useQueryClient()
  const libraryFetching = useIsFetching({ queryKey: queryKeys.library }) > 0
  const offline = useOffline()

  const tags = library?.tags ?? []
  const playlists = library?.playlists ?? []
  const pinned = playlists.filter(list => list.pinned)
  const untaggedCount = (library?.songs ?? []).filter(
    song => song.tagIds.length === 0 && !song.missing,
  ).length

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
    <nav className="sidebar" aria-label="Main navigation" inert={inert}>
      <div className="brand">
        <BrandMark />
        <span>
          self<span className="brand-dot">.</span>mp3
        </span>
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
        {/* Built for the web there is no Mac to import on or count plays. */}
        {!CLOUD && (
          <NavLink to="/import" className="nav-item">
            <Download size={17} /> Import
          </NavLink>
        )}
        {!CLOUD && (
          <NavLink to="/stats" className="nav-item">
            <BarChart size={17} /> Stats
          </NavLink>
        )}
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
            {selectedTags.size + excludedTags.size > 0 && (
              <button
                type="button"
                className="icon-button icon-button-tiny"
                onClick={onClearTags}
                aria-label="Clear tag filters"
                data-tip="Clear filters"
              >
                <X size={13} />
              </button>
            )}
            <button
              type="button"
              className="icon-button icon-button-tiny"
              onClick={() => setAdding(open => !open)}
              aria-label="New tag"
              data-tip="New tag"
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
          {untaggedCount > 0 && !CLOUD && (
            <NavLink to="/inbox" className="tag-row tag-row-inbox">
              <span className="tag-row-main">
                <Inbox size={14} />
                <span className="tag-row-name">Untagged</span>
                <span className="tag-row-count">{untaggedCount}</span>
              </span>
            </NavLink>
          )}

          {tags.map(tag => (
            <SidebarTagRow
              key={tag.id}
              tag={tag}
              filter={
                selectedTags.has(tag.id)
                  ? 'include'
                  : excludedTags.has(tag.id)
                    ? 'exclude'
                    : 'off'
              }
              onInclude={() => onToggleTag(tag.id)}
              onExclude={() => onExcludeTag(tag.id)}
            />
          ))}

          {tags.length === 0 && !adding && (
            <div className="tag-empty">
              <Tag size={16} />
              <p className="hint">
                No tags yet. Tags are how you find things later — try “chill”.
              </p>
              <button type="button" className="link-button" onClick={() => setAdding(true)}>
                Add your first tag
              </button>
            </div>
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

        {CLOUD ? (
          // No folder to scan on the web: look for a newer snapshot instead.
          <button
            type="button"
            className="nav-item nav-item-small"
            onClick={() => void queryClient.invalidateQueries({ queryKey: queryKeys.library })}
            disabled={libraryFetching}
          >
            <Refresh size={15} />
            <span className="nav-item-label">
              {libraryFetching ? 'Checking…' : 'Check for new songs'}
            </span>
          </button>
        ) : (
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
        )}
      </div>
    </nav>
  )
}

/**
 * One tag in the sidebar.
 *
 * A click filters to it, as it always has. The two controls that appear on
 * hover are the other things a tag is for: hiding it ("everything but
 * instrumental") and editing it. ⌥-click is the shortcut for hiding.
 */
function SidebarTagRow({
  tag,
  filter,
  onInclude,
  onExclude,
}: {
  tag: TagType
  filter: TagFilterState
  onInclude: () => void
  onExclude: () => void
}) {
  const [editing, setEditing] = useState(false)
  const moreRef = useRef<HTMLButtonElement>(null)

  return (
    <div
      className={`tag-row ${filter === 'include' ? 'is-active' : ''} ${
        filter === 'exclude' ? 'is-excluded' : ''
      } ${editing ? 'is-editing' : ''}`}
      style={{ '--tag-hue': tag.hue } as React.CSSProperties}
    >
      <button
        type="button"
        className="tag-row-main"
        onClick={event => (event.altKey ? onExclude() : onInclude())}
        aria-pressed={filter === 'include'}
        data-tip={
          filter === 'exclude'
            ? `Hiding songs tagged ${tag.name} — click to show only them`
            : `Show songs tagged ${tag.name} (⌥-click to hide them)`
        }
      >
        <span className="tag-dot" />
        <span className="tag-row-name">
          {filter === 'exclude' && <span className="tag-row-not">not </span>}
          {tag.name}
        </span>
        <span className="tag-row-count">{tag.songCount}</span>
      </button>
      <button
        type="button"
        className={`tag-row-action tag-row-exclude ${filter === 'exclude' ? 'is-on' : ''}`}
        onClick={onExclude}
        aria-pressed={filter === 'exclude'}
        aria-label={filter === 'exclude' ? `Stop hiding ${tag.name}` : `Hide songs tagged ${tag.name}`}
        data-tip={filter === 'exclude' ? 'Stop hiding' : 'Hide these songs'}
      >
        <Minus size={13} />
      </button>
      <button
        ref={moreRef}
        type="button"
        className="tag-row-action tag-row-more"
        onClick={() => setEditing(open => !open)}
        aria-haspopup="dialog"
        aria-expanded={editing}
        aria-label={`Edit tag ${tag.name}`}
        data-tip="Rename, recolour or delete"
      >
        <More size={13} />
      </button>
      {editing && (
        <TagEditor
          anchorRef={moreRef}
          tag={tag}
          filter={filter}
          onInclude={onInclude}
          onExclude={onExclude}
          onDeleted={() => {
            if (filter === 'include') onInclude()
            if (filter === 'exclude') onExclude()
          }}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  )
}
