import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { formatLongDuration, fuzzyRank, type Song, type SongSortField } from '@selfmp3/shared'
import { useLibrary, useScanLibrary } from '../lib/queries.js'
import { usePlayer } from '../player/PlayerProvider.js'
import { useDebounced, useIsMobile } from '../lib/hooks.js'
import { useSelection } from '../lib/selection.js'
import { SongRow } from '../components/SongRow.js'
import { SelectionBar } from '../components/SelectionBar.js'
import { TagChip } from '../components/TagChip.js'
import { GemsRow } from '../components/GemsRow.js'
import { Select } from '../components/Select.js'
import {
  CheckSquare,
  Download,
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
  onToggleTag,
  onClearTags,
}: {
  selectedTags: ReadonlySet<number>
  onToggleTag: (tagId: number) => void
  onClearTags: () => void
}) {
  const { data: library, isLoading, error } = useLibrary()
  const player = usePlayer()
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

    // Tags combine with AND: "chinese" + "chill" means both, not either.
    if (effectiveTags.size > 0) {
      result = result.filter(song => {
        for (const tagId of effectiveTags) if (!song.tagIds.includes(tagId)) return false
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
  }, [songs, effectiveTags, debouncedQuery, sort, descending])

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
  const narrowed = effectiveTags.size > 0 || debouncedQuery.trim().length > 0

  const heading =
    effectiveTags.size > 0
      ? [...effectiveTags]
          .map(id => tagById.get(id)?.name)
          .filter(Boolean)
          .join(' · ')
      : 'Library'

  const playAll = (): void => {
    if (filtered.length === 0) return
    if (player.queue.shuffle) player.toggleShuffle()
    player.playFrom(filtered, 0)
  }

  const shuffleAll = (): void => {
    if (filtered.length === 0) return
    if (!player.queue.shuffle) player.toggleShuffle()
    player.playFrom(filtered, Math.floor(Math.random() * filtered.length))
  }

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
              title={descending ? 'Descending — click for ascending' : 'Ascending — click for descending'}
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
              title={
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
              title="Shuffle"
            >
              <Shuffle size={15} /> <span className="button-label">Shuffle</span>
            </button>
          </div>
        </div>
      </header>

      {/* Only on the unfiltered library: a "forgotten" row inside a search
          result would be about the search, not about what you have forgotten. */}
      {effectiveTags.size === 0 && !debouncedQuery.trim() && <GemsRow />}

      {isMobile && tags.length > 0 && (
        <div className="mobile-tag-strip">
          {tags.map(tag => (
            <TagChip
              key={tag.id}
              tag={tag}
              active={effectiveTags.has(tag.id)}
              onClick={() => onToggleTag(tag.id)}
              size="small"
            />
          ))}
        </div>
      )}

      {effectiveTags.size > 0 && (
        <div className="active-filters">
          <span className="hint">Filtered by</span>
          {[...effectiveTags].map(tagId => {
            const tag = tagById.get(tagId)
            return tag ? (
              <TagChip key={tagId} tag={tag} active onRemove={() => onToggleTag(tagId)} />
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
                  {effectiveTags.size > 0 ? ' with these tags' : ''}.
                </>
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
              {effectiveTags.size > 0 && (
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

/**
 * Sorting.
 *
 * Nulls always sort last regardless of direction — a song that has never been
 * played should not top the "recently played" list just because the direction
 * flipped.
 */
function sortSongs(songs: readonly Song[], field: SongSortField, descending: boolean): Song[] {
  const sorted = [...songs]
  const direction = descending ? -1 : 1

  sorted.sort((a, b) => {
    switch (field) {
      case 'title':
        return direction * a.title.localeCompare(b.title)
      case 'artist':
        return direction * (a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title))
      case 'album':
        return direction * (a.album.localeCompare(b.album) || (a.trackNo ?? 0) - (b.trackNo ?? 0))
      case 'duration':
        return direction * (a.duration - b.duration)
      case 'playCount':
        return direction * (a.playCount - b.playCount)
      case 'lastPlayedAt': {
        if (!a.lastPlayedAt && !b.lastPlayedAt) return 0
        if (!a.lastPlayedAt) return 1
        if (!b.lastPlayedAt) return -1
        return direction * a.lastPlayedAt.localeCompare(b.lastPlayedAt)
      }
      case 'random':
        return Math.random() - 0.5
      case 'addedAt':
      default:
        return direction * (a.addedAt.localeCompare(b.addedAt) || a.id - b.id)
    }
  })

  return sorted
}
