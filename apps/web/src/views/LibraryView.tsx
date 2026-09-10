import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  formatLongDuration,
  fuzzyRank,
  type Song,
  type SongSortField,
  type Tag,
} from '@selfmp3/shared'
import { useBulkTag, useLibrary } from '../lib/queries.js'
import { usePlayer } from '../player/PlayerProvider.js'
import { useDebounced, useIsMobile } from '../lib/hooks.js'
import { SongRow } from '../components/SongRow.js'
import { TagChip } from '../components/TagChip.js'
import { GemsRow } from '../components/GemsRow.js'
import { Select } from '../components/Select.js'
import { Play, Search, Shuffle, X } from '../components/Icons.js'

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
  const bulkTag = useBulkTag()
  const [searchParams] = useSearchParams()

  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SongSortField>('addedAt')
  const [descending, setDescending] = useState(true)
  const [selection, setSelection] = useState<ReadonlySet<number>>(() => new Set())

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
    // Multi-select only with a modifier, so a plain click stays "just look at it".
    if (!event.metaKey && !event.ctrlKey && !event.shiftKey) {
      setSelection(new Set())
      return
    }
    event.preventDefault()
    setSelection(current => {
      const next = new Set(current)
      if (next.has(song.id)) next.delete(song.id)
      else next.add(song.id)
      return next
    })
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

        <div className="view-actions">
          <div className="search-box">
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

          <Select<SongSortField>
            value={sort}
            onChange={setSort}
            options={SORT_OPTIONS}
            label="Sort by"
            align="end"
          />

          <button
            type="button"
            className="button"
            onClick={() => setDescending(value => !value)}
            aria-label={descending ? 'Sort ascending' : 'Sort descending'}
            title={descending ? 'Descending' : 'Ascending'}
          >
            {descending ? '↓' : '↑'}
          </button>

          <button type="button" className="button button-primary" onClick={playAll}>
            <Play size={15} /> Play
          </button>

          <button type="button" className="button" onClick={shuffleAll}>
            <Shuffle size={15} /> Shuffle
          </button>
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

      {selection.size > 0 && (
        <SelectionBar
          count={selection.size}
          tags={tags}
          onTag={tagId =>
            bulkTag.mutate({ songIds: [...selection], tagId, action: 'add' })
          }
          onPlay={() => {
            const chosen = filtered.filter(song => selection.has(song.id))
            if (chosen.length > 0) player.playFrom(chosen, 0)
          }}
          onQueue={() => player.addToQueue(filtered.filter(song => selection.has(song.id)))}
          onClear={() => setSelection(new Set())}
        />
      )}

      {filtered.length === 0 ? (
        <div className="empty-state">
          <p className="empty-emoji">🎧</p>
          <h2>{songs.length === 0 ? 'Nothing here yet' : 'No matches'}</h2>
          <p className="hint">
            {songs.length === 0 ? (
              <>
                Drop audio files into your <code>library/</code> folder and hit Rescan, or use{' '}
                <strong>Import</strong> to pull a song in from a link.
              </>
            ) : (
              'Try a different search, or clear your tag filters.'
            )}
          </p>
        </div>
      ) : (
        <div className="song-list" role="table">
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
            />
          ))}
        </div>
      )}
    </section>
  )
}

/** The bar that appears when songs are multi-selected. */
function SelectionBar({
  count,
  tags,
  onTag,
  onPlay,
  onQueue,
  onClear,
}: {
  count: number
  tags: readonly Tag[]
  onTag: (tagId: number) => void
  onPlay: () => void
  onQueue: () => void
  onClear: () => void
}) {
  return (
    <div className="selection-bar" role="toolbar" aria-label="Selection actions">
      <span className="selection-count">{count} selected</span>

      <button type="button" className="button button-small" onClick={onPlay}>
        <Play size={13} /> Play
      </button>

      <button type="button" className="button button-small" onClick={onQueue}>
        Add to queue
      </button>

      {tags.length > 0 && (
        <Select<number>
          value={0}
          onChange={tagId => {
            if (tagId > 0) onTag(tagId)
          }}
          options={tags.map(tag => ({ value: tag.id, label: tag.name }))}
          label="Add a tag to the selection"
          placeholder="Add tag…"
          size="small"
        />
      )}

      <button
        type="button"
        className="icon-button"
        onClick={onClear}
        aria-label="Clear selection"
      >
        <X size={15} />
      </button>
    </div>
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
