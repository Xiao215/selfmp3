import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatDuration, fuzzyRank, isCjkQuery, type Library, type Song } from '@selfmp3/shared'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api.js'
import { useDebounced } from '../lib/hooks.js'
import { queryKeys } from '../lib/queries.js'
import { usePlayer } from '../player/PlayerProvider.js'
import { Cover } from './Cover.js'
import { BarChart, ListMusic, Mic, Music, Search, Settings, Shuffle, Tag } from './Icons.js'

/**
 * The ⌘K palette.
 *
 * One box that searches songs, playlists and tags and also runs commands. It
 * is the fastest path to anything in the app, and on a large library it is
 * considerably faster than scrolling — which is why it exists at all.
 */

type Command = {
  readonly id: string
  readonly label: string
  readonly hint?: string
  readonly icon: React.ReactNode
  readonly run: () => void
}

export function CommandPalette({
  library,
  open,
  onClose,
}: {
  library: Library | undefined
  open: boolean
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const optionId = (index: number): string => `${listId}-option-${index}`
  const navigate = useNavigate()
  const player = usePlayer()

  useEffect(() => {
    if (open) {
      setQuery('')
      setHighlighted(0)
      // A frame's delay lets the dialog mount before focus moves, which stops
      // iOS from scrolling the page under the keyboard.
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const songs = library?.songs ?? []
  const playlists = library?.playlists ?? []
  const tags = library?.tags ?? []

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      {
        id: 'nav-library',
        label: 'Go to Library',
        icon: <Music size={16} />,
        run: () => void navigate('/'),
      },
      {
        id: 'nav-playlists',
        label: 'Go to Playlists',
        icon: <ListMusic size={16} />,
        run: () => void navigate('/playlists'),
      },
      {
        id: 'nav-import',
        label: 'Import music',
        icon: <Search size={16} />,
        run: () => void navigate('/import'),
      },
      {
        id: 'nav-stats',
        label: 'Listening stats',
        icon: <BarChart size={16} />,
        run: () => void navigate('/stats'),
      },
      {
        id: 'nav-settings',
        label: 'Settings',
        icon: <Settings size={16} />,
        run: () => void navigate('/settings'),
      },
      {
        id: 'shuffle-all',
        label: 'Shuffle everything',
        hint: `${songs.length} songs`,
        icon: <Shuffle size={16} />,
        run: () => {
          if (songs.length === 0) return
          if (!player.queue.shuffle) player.toggleShuffle()
          player.playFrom(songs, Math.floor(Math.random() * songs.length))
        },
      },
    ]
    return list
  }, [navigate, player, songs])

  const trimmed = query.trim()

  const matchedSongs = useMemo(() => {
    if (!trimmed) return []
    return fuzzyRank(trimmed, songs, song => `${song.title} ${song.artist} ${song.album}`)
      .slice(0, 8)
      .map(match => match.item)
  }, [trimmed, songs])

  const matchedCommands = useMemo(
    () =>
      trimmed
        ? fuzzyRank(trimmed, commands, command => command.label)
            .slice(0, 5)
            .map(match => match.item)
        : commands,
    [trimmed, commands],
  )

  const matchedPlaylists = useMemo(
    () =>
      trimmed
        ? fuzzyRank(trimmed, playlists, list => list.name)
            .slice(0, 4)
            .map(match => match.item)
        : [],
    [trimmed, playlists],
  )

  const matchedTags = useMemo(
    () =>
      trimmed
        ? fuzzyRank(trimmed, tags, tag => tag.name)
            .slice(0, 4)
            .map(match => match.item)
        : [],
    [trimmed, tags],
  )

  // Lyrics+: search inside lyrics on the server. Debounced, and only once the
  // query is long enough to mean something — two characters is a word in
  // Chinese or Japanese, three is the floor for Latin text.
  const debounced = useDebounced(trimmed, 180)
  const lyricsQuery = debounced.length >= (isCjkQuery(debounced) ? 2 : 3) ? debounced : ''
  const lyricsHits = useQuery({
    queryKey: queryKeys.lyricsSearch(lyricsQuery),
    queryFn: () => api.lyricsSearch(lyricsQuery, 6),
    enabled: open && lyricsQuery !== '',
    retry: false,
    staleTime: 60_000,
    placeholderData: previous => previous,
  })
  const matchedLyrics = useMemo(
    () => (lyricsQuery ? (lyricsHits.data?.hits ?? []) : []),
    [lyricsQuery, lyricsHits.data],
  )

  /** One flat list of everything selectable, so arrow keys work across groups. */
  const flat = useMemo(() => {
    const entries: Array<{ key: string; run: () => void }> = []
    for (const command of matchedCommands) entries.push({ key: command.id, run: command.run })
    for (const song of matchedSongs) {
      entries.push({
        key: `song-${song.id}`,
        run: () => {
          const index = songs.findIndex(item => item.id === song.id)
          player.playFrom(songs, index < 0 ? 0 : index)
        },
      })
    }
    for (const list of matchedPlaylists) {
      entries.push({ key: `playlist-${list.id}`, run: () => void navigate(`/playlists/${list.id}`) })
    }
    for (const tag of matchedTags) {
      entries.push({ key: `tag-${tag.id}`, run: () => void navigate(`/?tag=${tag.id}`) })
    }
    for (const hit of matchedLyrics) {
      entries.push({
        key: `lyric-${hit.songId}`,
        run: () => {
          const index = songs.findIndex(item => item.id === hit.songId)
          if (index >= 0) player.playFrom(songs, index)
        },
      })
    }
    return entries
  }, [
    matchedCommands,
    matchedSongs,
    matchedPlaylists,
    matchedTags,
    matchedLyrics,
    songs,
    player,
    navigate,
  ])

  useEffect(() => {
    setHighlighted(current => Math.min(current, Math.max(0, flat.length - 1)))
  }, [flat.length])

  // Keep the highlighted row in view as the arrow keys move through it.
  useEffect(() => {
    const element = listRef.current?.querySelector(`[data-index="${highlighted}"]`)
    element?.scrollIntoView({ block: 'nearest' })
  }, [highlighted])

  if (!open) return null

  const activate = (index: number): void => {
    flat[index]?.run()
    onClose()
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlighted(current => (current + 1) % Math.max(1, flat.length))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlighted(current => (current - 1 + flat.length) % Math.max(1, flat.length))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      activate(highlighted)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  let cursor = 0

  return (
    <div className="palette-backdrop" onClick={onClose} role="presentation">
      <div
        className="palette"
        onClick={event => event.stopPropagation()}
        role="dialog"
        aria-label="Command palette"
      >
        <div className="palette-input-row">
          <Search size={18} />
          <input
            ref={inputRef}
            className="palette-input"
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search songs, playlists, tags — or type a command"
            spellCheck={false}
            autoComplete="off"
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={flat.length > 0 ? optionId(highlighted) : undefined}
            aria-label="Search songs, playlists and tags, or type a command"
          />
          {trimmed && (
            <span className="palette-count" aria-live="polite">
              {flat.length} {flat.length === 1 ? 'result' : 'results'}
            </span>
          )}
        </div>

        <div className="palette-results" ref={listRef} role="listbox" id={listId}>
          {matchedCommands.length > 0 && (
            <div className="palette-group">
              <div className="palette-group-title">
                Actions
                <span>{matchedCommands.length}</span>
              </div>
              {matchedCommands.map(command => {
                const index = cursor++
                return (
                  <button
                    key={command.id}
                    type="button"
                    data-index={index}
                    id={optionId(index)}
                    role="option"
                    aria-selected={index === highlighted}
                    className={`palette-item ${index === highlighted ? 'is-active' : ''}`}
                    onMouseEnter={() => setHighlighted(index)}
                    onClick={() => activate(index)}
                  >
                    {command.icon}
                    <span className="palette-label">{command.label}</span>
                    {command.hint && <span className="palette-hint">{command.hint}</span>}
                  </button>
                )
              })}
            </div>
          )}

          {matchedSongs.length > 0 && (
            <div className="palette-group">
              <div className="palette-group-title">
                Songs
                <span>{matchedSongs.length}</span>
              </div>
              {matchedSongs.map((song: Song) => {
                const index = cursor++
                return (
                  <button
                    key={song.id}
                    type="button"
                    data-index={index}
                    id={optionId(index)}
                    role="option"
                    aria-selected={index === highlighted}
                    className={`palette-item ${index === highlighted ? 'is-active' : ''}`}
                    onMouseEnter={() => setHighlighted(index)}
                    onClick={() => activate(index)}
                  >
                    <Cover song={song} size={28} />
                    <span className="palette-label">
                      {song.title}
                      <span className="palette-sub">{song.artist || 'Unknown artist'}</span>
                    </span>
                    <span className="palette-hint">{formatDuration(song.duration)}</span>
                  </button>
                )
              })}
            </div>
          )}

          {matchedPlaylists.length > 0 && (
            <div className="palette-group">
              <div className="palette-group-title">
                Playlists
                <span>{matchedPlaylists.length}</span>
              </div>
              {matchedPlaylists.map(list => {
                const index = cursor++
                return (
                  <button
                    key={list.id}
                    type="button"
                    data-index={index}
                    id={optionId(index)}
                    role="option"
                    aria-selected={index === highlighted}
                    className={`palette-item ${index === highlighted ? 'is-active' : ''}`}
                    onMouseEnter={() => setHighlighted(index)}
                    onClick={() => activate(index)}
                  >
                    <ListMusic size={16} />
                    <span className="palette-label">{list.name}</span>
                    <span className="palette-hint">{list.songCount} songs</span>
                  </button>
                )
              })}
            </div>
          )}

          {matchedTags.length > 0 && (
            <div className="palette-group">
              <div className="palette-group-title">
                Tags
                <span>{matchedTags.length}</span>
              </div>
              {matchedTags.map(tag => {
                const index = cursor++
                return (
                  <button
                    key={tag.id}
                    type="button"
                    data-index={index}
                    id={optionId(index)}
                    role="option"
                    aria-selected={index === highlighted}
                    className={`palette-item ${index === highlighted ? 'is-active' : ''}`}
                    onMouseEnter={() => setHighlighted(index)}
                    onClick={() => activate(index)}
                  >
                    <Tag size={16} />
                    <span className="palette-label">{tag.name}</span>
                    <span className="palette-hint">{tag.songCount} songs</span>
                  </button>
                )
              })}
            </div>
          )}

          {matchedLyrics.length > 0 && (
            <div className="palette-group">
              <div className="palette-group-title">
                Lyrics
                <span>{matchedLyrics.length}</span>
              </div>
              {matchedLyrics.map(hit => {
                const index = cursor++
                return (
                  <button
                    key={hit.songId}
                    type="button"
                    data-index={index}
                    id={optionId(index)}
                    role="option"
                    aria-selected={index === highlighted}
                    className={`palette-item ${index === highlighted ? 'is-active' : ''}`}
                    onMouseEnter={() => setHighlighted(index)}
                    onClick={() => activate(index)}
                  >
                    <Mic size={16} />
                    <span className="palette-label">
                      <span className="palette-lyric">
                        {hit.before}
                        {hit.match && <mark>{hit.match}</mark>}
                        {hit.after}
                      </span>
                      <span className="palette-sub">
                        {hit.title}
                        {hit.artist ? ` · ${hit.artist}` : ''}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {trimmed && flat.length === 0 && (
            <p className="empty-hint">
              Nothing matches “{trimmed}”.
              <br />
              Try fewer letters, or part of a lyric.
            </p>
          )}
        </div>

        {/*
          * The keys are the whole point of a palette; saying so costs one row
          * and saves everyone the guess.
          */}
        <footer className="palette-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> move
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
        </footer>
      </div>
    </div>
  )
}
