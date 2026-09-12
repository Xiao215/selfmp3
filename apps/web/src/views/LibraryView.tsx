import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  formatLongDuration,
  fuzzyRank,
  sortSongs,
  type Song,
  type SongSortField,
  type Tag,
} from '@selfmp3/shared'
import { useLibrary, useScanLibrary } from '../lib/queries.js'
import { usePlayer } from '../player/PlayerProvider.js'
import { useOffline } from '../offline/OfflineProvider.js'
import { OfflinePill } from '../offline/OfflineStatus.js'
import { useDebounced, useIsMobile } from '../lib/hooks.js'
import { useSelection } from '../lib/selection.js'
import { SongRow } from '../components/SongRow.js'
import { SelectionBar } from '../components/SelectionBar.js'
import { TagChip } from '../components/TagChip.js'
import { TagEditor, type TagFilterState } from '../components/TagEditor.js'
import { GemsRow } from '../components/GemsRow.js'
import { Select } from '../components/Select.js'
import { showToast } from '../components/Toast.js'
import {
  CheckSquare,
  Download,
  Inbox,
  Play,
  Refresh,
  Search,
  Shuffle,
  X,
} from '../components/Icons.js'

/**
 * The library.
 *
 * Filtering and sorting happen entirely client-side. A personal library fits
 * comfortably in memory, so every keystroke and every tag toggle is instant
 * and works with no connection at all — which is exactly what you want when
 * the Mac is asleep and you are on a train.
 */

const SORT_OPTIONS: ReadonlyArray<{ value: SongSortField; label: string }> = [
  { value: 'addedAt', label: 'Recently added' },
  { value: 'title', label: 'Title' },
  { value: 'artist', label: 'Artist' },
  { value: 'album', label: 'Album' },
  { value: 'duration', label: 'Length' },
  { value: 'playCount', label: 'Most played' },
  { value: 'lastPlayedAt', label: 'Recently played' },
]

export function LibraryView({
  selectedTags,
  excludedTags,
  onToggleTag,
  onExcludeTag,
  onClearTags,
}: {
  selectedTags: ReadonlySet<number>
  /** Tags filtered *out*: a song carrying any of them is hidden. */
  excludedTags: ReadonlySet<number>
  onToggleTag: (tagId: number) => void
  onExcludeTag: (tagId: number) => void
  onClearTags: () => void
}) {
  const { data: library, isLoading, error } = useLibrary()
  const player = usePlayer()
  const offline = useOffline()
  const isMobile = useIsMobile()
  const scan = useScanLibrary()
  const [searchParams] = useSearchParams()

  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SongSortField>('addedAt')
  const [descending, setDescending] = useState(true)

  const debouncedQuery = useDebounced(query, 150)

  const songs = useMemo(() => library?.songs ?? [], [library])
  const tags = useMemo(() => library?.tags ?? [], [library])
  const tagById = useMemo(() => new Map(tags.map(tag => [tag.id, tag])), [tags])

  // A tag can also arrive via the URL, from the command palette.
  const urlTag = searchParams.get('tag')
  const effectiveTags = useMemo(() => {
    if (!urlTag) return selectedTags
    const merged = new Set(selectedTags)
    const parsed = Number(urlTag)
    if (Number.isInteger(parsed)) merged.add(parsed)
    return merged
  }, [selectedTags, urlTag])

  const filtered = useMemo(() => {
    let result = songs

    // Tags combine with AND: "chinese" + "chill" means both, not either. An
    // excluded tag is the other side of the same rule — "chill" but not
    // "instrumental" — so a song carrying any of those is out.
    if (effectiveTags.size > 0 || excludedTags.size > 0) {
      result = result.filter(song => {
        for (const tagId of effectiveTags) if (!song.tagIds.includes(tagId)) return false
        for (const tagId of excludedTags) if (song.tagIds.includes(tagId)) return false
        return true
      })
    }

    if (debouncedQuery.trim()) {
      result = fuzzyRank(
        debouncedQuery,
        result,
        song => `${song.title} ${song.artist} ${song.album}`,
      ).map(match => match.item)
      // Fuzzy results are already ranked by relevance; re-sorting would throw
      // that away, so return early.
      return result
    }

    return sortSongs(result, sort, descending)
  }, [songs, effectiveTags, excludedTags, debouncedQuery, sort, descending])

  const totalSeconds = useMemo(
    () => filtered.reduce((sum, song) => sum + song.duration, 0),
    [filtered],
  )

  // Multi-select runs off the *filtered* list, which is what makes "select
  // all" mean the six songs you can see rather than the whole library — and
  // what makes a song that a search has hidden drop out of the selection
  // rather than be quietly deleted along with the rest.
  const visibleIds = useMemo(() => filtered.map(song => song.id), [filtered])
  const selection = useSelection(visibleIds)
  const selectedSongs = useMemo(
    () => filtered.filter(song => selection.has(song.id)),
    [filtered, selection],
  )
  const tagFiltered = effectiveTags.size > 0 || excludedTags.size > 0
  const narrowed = tagFiltered || debouncedQuery.trim().length > 0

  // "chill · not instrumental"; with only exclusions, "Library · not instrumental".
  const heading = tagFiltered
    ? [
        ...(effectiveTags.size === 0 ? ['Library'] : []),
        ...[...effectiveTags].map(id => tagById.get(id)?.name),
        ...[...excludedTags].map(id => {
          const name = tagById.get(id)?.name
          return name ? `not ${name}` : undefined
        }),
      ]
        .filter(Boolean)
        .join(' · ')
    : 'Library'

  const untaggedCount = useMemo(
    () => songs.filter(song => song.tagIds.length === 0 && !song.missing).length,
    [songs],
  )

  /**
   * What Play and Shuffle start from. With the Mac out of reach that is only
   * what is on this device — a queue of songs that cannot load would just
   * fail through them one by one.
   */
  const playable = (): Song[] => {
    if (offline.serverReachable) return filtered
    const onDevice = filtered.filter(song => offline.isCached(song.id))
    if (onDevice.length === 0) {
      showToast('None of these are downloaded, and your Mac isn’t reachable.', 'info', 3500)
    }
    return onDevice
  }

  const playAll = (): void => {
    const list = playable()
    if (list.length === 0) return
    if (player.queue.shuffle) player.toggleShuffle()
    player.playFrom(list, 0)
  }

  const shuffleAll = (): void => {
    const list = playable()
    if (list.length === 0) return
    if (!player.queue.shuffle) player.toggleShuffle()
    player.playFrom(list, Math.floor(Math.random() * list.length))
  }

  const filterStateOf = (tagId: number): TagFilterState =>
    effectiveTags.has(tagId) ? 'include' : excludedTags.has(tagId) ? 'exclude' : 'off'

  const onSelectRow = (song: Song, event: React.MouseEvent): void => {
    // Cmd and Shift stay what they always were, for the people who know them;
    // the checkbox and the Select button are the same thing made visible.
    if (event.metaKey || event.ctrlKey || event.shiftKey) event.preventDefault()
    selection.click(song.id, event)
  }

  /** Cmd/Ctrl+A selects within the list, not the whole page. */
  const onListKeyDown = (event: React.KeyboardEvent): void => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      event.stopPropagation()
      selection.selectAll()
    }
  }

  if (error && !library) {
    return (
      <section className="view">
        <div className="empty-state">
          <p className="empty-emoji">😴</p>
          <h2>Can’t reach your library</h2>
          <p className="hint">
            Your Mac may be asleep. Anything you have downloaded still plays — everything else
            will come back when it wakes up.
          </p>
        </div>
      </section>
    )
  }

  return (
    <section className="view library-view">
      <header className="view-head">
        <div className="view-titles">
          <h1>{heading}</h1>
          <p className="view-sub">
            {isLoading && !library
              ? 'Loading…'
              : `${filtered.length} ${filtered.length === 1 ? 'song' : 'songs'} · ${formatLongDuration(totalSeconds)}`}
            <OfflinePill />
          </p>
        </div>

        {/*
          Three groups rather than five loose controls: find, order, play. On a
          phone the search takes a line of its own and the other two share the
          next one, which is the difference between two comfortable rows and
          three cramped ones.
        */}
        <div className="view-actions library-actions">
          <div className="search-box library-search">
            <Search size={15} />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search"
              spellCheck={false}
              aria-label="Search library"
            />
            {query && (
              <button
                type="button"
                className="icon-button icon-button-tiny"
                onClick={() => setQuery('')}
                aria-label="Clear search"
              >
                <X size={13} />
              </button>
            )}
          </div>

          <div className="library-order">
            <Select<SongSortField>
              value={sort}
              onChange={setSort}
              options={SORT_OPTIONS}
              label="Sort by"
              align="end"
              className="library-sort"
            />

            <button
              type="button"
              className="button library-direction"
              onClick={() => setDescending(value => !value)}
              aria-label={descending ? 'Sort ascending' : 'Sort descending'}
              data-tip={descending ? 'Descending — click for ascending' : 'Ascending — click for descending'}
            >
              <span aria-hidden="true">{descending ? '↓' : '↑'}</span>
            </button>
          </div>

          <div className="library-transport">
            {/*
              The way in, on every device. Multi-select used to be reachable
              only by knowing that Cmd-click did something — invisible on a
              Mac and impossible on a phone, which has no Cmd key at all.
            */}
            <button
              type="button"
              className={`button library-select ${selection.active ? 'is-active' : ''}`}
              onClick={() => (selection.active ? selection.clear() : selection.enter())}
              disabled={filtered.length === 0}
              aria-pressed={selection.active}
              data-tip={
                selection.active
                  ? 'Done selecting (Esc)'
                  : 'Select songs to act on several at once'
              }
            >
              <CheckSquare size={15} />{' '}
              <span className="button-label">{selection.active ? 'Done' : 'Select'}</span>
            </button>

            <button
              type="button"
              className="button button-primary"
              onClick={playAll}
              disabled={filtered.length === 0}
            >
              <Play size={15} /> <span className="button-label">Play</span>
            </button>

            <button
              type="button"
              className="button library-shuffle"
              onClick={shuffleAll}
              disabled={filtered.length === 0}
              aria-label="Shuffle"
              data-tip="Shuffle"
            >
              <Shuffle size={15} /> <span className="button-label">Shuffle</span>
            </button>
          </div>
        </div>
      </header>

      {/* Only on the unfiltered library: a "forgotten" row inside a search
          result would be about the search, not about what you have forgotten. */}
      {!tagFiltered && !debouncedQuery.trim() && <GemsRow />}

      {/*
        On a phone the strip is the sidebar's tag list. A tap filters, as
        before; holding a chip opens the same editor the sidebar's ⋯ does —
        rename, recolour, hide, delete — since a phone has no other way to
        manage tags at all.
      */}
      {isMobile && (tags.length > 0 || untaggedCount > 0) && (
        <div className="mobile-tag-strip">
          {untaggedCount > 0 && (
            <Link to="/inbox" className="tag-chip is-small tag-chip-inbox">
              <span className="tag-chip-label">
                <Inbox size={12} /> Untagged {untaggedCount}
              </span>
            </Link>
          )}
          {tags.map(tag => (
            <MobileTagChip
              key={tag.id}
              tag={tag}
              filter={filterStateOf(tag.id)}
              onInclude={() => onToggleTag(tag.id)}
              onExclude={() => onExcludeTag(tag.id)}
            />
          ))}
        </div>
      )}

      {tagFiltered && (
        <div className="active-filters">
          <span className="hint">Filtered by</span>
          {[...effectiveTags].map(tagId => {
            const tag = tagById.get(tagId)
            return tag ? (
              <TagChip
                key={tagId}
                tag={tag}
                active
                onClick={() => onExcludeTag(tagId)}
                onRemove={() => onToggleTag(tagId)}
                tip={`Showing only ${tag.name} — click to hide it instead`}
              />
            ) : null
          })}
          {[...excludedTags].map(tagId => {
            const tag = tagById.get(tagId)
            return tag ? (
              <TagChip
                key={tagId}
                tag={tag}
                excluded
                onClick={() => onToggleTag(tagId)}
                onRemove={() => onExcludeTag(tagId)}
                tip={`Hiding ${tag.name} — click to show only it instead`}
              />
            ) : null
          })}
          <button type="button" className="link-button" onClick={onClearTags}>
            clear
          </button>
        </div>
      )}

      {selection.active && (
        <SelectionBar
          songs={selectedSongs}
          total={filtered.length}
          narrowed={narrowed}
          scope={narrowed ? 'in this view' : 'in your library'}
          allSelected={selection.allSelected}
          onSelectAll={selection.selectAll}
          onDeselectAll={selection.deselectAll}
          onDone={selection.clear}
        />
      )}

      {filtered.length === 0 ? (
        isLoading && !library ? (
          // Not an empty library — one we have not heard back about yet. The
          // "drop files in and rescan" pitch would be wrong here.
          <p className="empty-hint">Loading your library…</p>
        ) : songs.length === 0 ? (
          <div className="empty-state">
            <p className="empty-emoji">🎧</p>
            <h2>Nothing here yet</h2>
            <p className="hint">
              Drop audio files into your <code>library/</code> folder and rescan, or import a
              song straight from a link.
            </p>
            <div className="empty-actions">
              <button
                type="button"
                className="button"
                onClick={() => scan.mutate()}
                disabled={scan.isPending}
              >
                <Refresh size={15} /> {scan.isPending ? 'Scanning…' : 'Rescan library'}
              </button>
              <Link className="button button-primary" to="/import">
                <Download size={15} /> Import a song
              </Link>
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <p className="empty-emoji">🔍</p>
            <h2>No matches</h2>
            <p className="hint">
              {debouncedQuery.trim() ? (
                <>
                  Nothing in your {songs.length} songs matches{' '}
                  <strong>“{debouncedQuery.trim()}”</strong>
                  {tagFiltered ? ' with these tags' : ''}.
                </>
              ) : excludedTags.size > 0 ? (
                'No song matches these tags once the hidden ones are left out.'
              ) : (
                'No song carries every one of these tags at once.'
              )}
            </p>
            <div className="empty-actions">
              {query && (
                <button type="button" className="button" onClick={() => setQuery('')}>
                  Clear search
                </button>
              )}
              {tagFiltered && (
                <button type="button" className="button" onClick={onClearTags}>
                  Clear tags
                </button>
              )}
            </div>
          </div>
        )
      ) : (
        <div
          className={`song-list ${selection.active ? 'is-selecting' : ''}`}
          role="table"
          aria-label={`${heading} songs`}
          onKeyDown={onListKeyDown}
        >
          {filtered.map((song, index) => (
            <SongRow
              key={song.id}
              song={song}
              index={index}
              tagById={tagById}
              isCurrent={player.current?.id === song.id}
              isPlaying={player.playing}
              selected={selection.has(song.id)}
              onPlay={() => player.playFrom(filtered, index)}
              onToggleTag={onToggleTag}
              onSelect={event => onSelectRow(song, event)}
              showIndex={!isMobile}
              selectable
              selectionMode={selection.mode}
              onToggleSelect={() => selection.toggle(song.id)}
              onStartSelecting={() => selection.enter(song.id)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

/** How long a finger rests on a chip before it opens the tag editor. */
const CHIP_HOLD_MS = 450

/**
 * A tag chip on the phone's strip: tap to filter, hold to edit.
 *
 * The hold is a timer on pointer-down, cancelled by lifting early or by the
 * strip scrolling sideways under the finger — the strip scrolls, so a drag
 * must never count as a hold.
 */
function MobileTagChip({
  tag,
  filter,
  onInclude,
  onExclude,
}: {
  tag: Tag
  filter: TagFilterState
  onInclude: () => void
  onExclude: () => void
}) {
  const [editing, setEditing] = useState(false)
  const anchorRef = useRef<HTMLSpanElement>(null)
  const timer = useRef<number | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const held = useRef(false)

  const cancel = (): void => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    origin.current = null
  }
  useEffect(() => cancel, [])

  return (
    <span
      ref={anchorRef}
      className="mobile-tag-chip"
      onPointerDown={event => {
        held.current = false
        origin.current = { x: event.clientX, y: event.clientY }
        timer.current = window.setTimeout(() => {
          held.current = true
          timer.current = null
          navigator.vibrate?.(8)
          setEditing(true)
        }, CHIP_HOLD_MS)
      }}
      onPointerMove={event => {
        const start = origin.current
        if (start && (Math.abs(event.clientX - start.x) > 8 || Math.abs(event.clientY - start.y) > 8)) {
          cancel()
        }
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onContextMenu={event => event.preventDefault()}
      onClickCapture={event => {
        // The lift that ends a hold must not also toggle the filter.
        if (held.current) {
          event.stopPropagation()
          event.preventDefault()
          held.current = false
        }
      }}
    >
      <TagChip
        tag={tag}
        active={filter === 'include'}
        excluded={filter === 'exclude'}
        onClick={filter === 'exclude' ? onExclude : onInclude}
        size="small"
      />
      {editing && (
        <TagEditor
          anchorRef={anchorRef}
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
    </span>
  )
}

