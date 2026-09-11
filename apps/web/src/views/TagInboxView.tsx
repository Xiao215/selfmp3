import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatLongDuration, type Song, type Tag } from '@selfmp3/shared'
import { useCreateTag, useLibrary, useSetSongTags } from '../lib/queries.js'
import { usePlayer } from '../player/PlayerProvider.js'
import { useIsMobile } from '../lib/hooks.js'
import { SongRow } from '../components/SongRow.js'
import { Cover } from '../components/Cover.js'
import { FeatureBadges } from '../components/FeatureBadges.js'
import { Check, ChevronRight, Inbox, Play, Plus, X } from '../components/Icons.js'

/**
 * Untagged songs, and a quick way through them.
 *
 * Tags are how this library is browsed, so a song without one is a song you
 * will only ever find by searching for it — and every import adds more. The
 * list says how many there are; "Start tagging" goes through them one at a
 * time: the song plays, the number keys toggle your tags, → moves on.
 */

const PLAY_ALONG_KEY = 'selfmp3:triage-play-along'

function isUntagged(song: Song): boolean {
  return song.tagIds.length === 0 && !song.missing
}

export function TagInboxView() {
  const { data: library, isLoading } = useLibrary()
  const player = usePlayer()
  const isMobile = useIsMobile()
  /** The ids being gone through, fixed when tagging starts. */
  const [session, setSession] = useState<readonly number[] | null>(null)

  const tagById = useMemo(() => new Map((library?.tags ?? []).map(tag => [tag.id, tag])), [library])
  const untagged = useMemo(
    () =>
      (library?.songs ?? [])
        .filter(isUntagged)
        .sort((a, b) => b.addedAt.localeCompare(a.addedAt) || b.id - a.id),
    [library],
  )
  const totalSeconds = untagged.reduce((sum, song) => sum + song.duration, 0)

  if (session) {
    return <Triage ids={session} onExit={() => setSession(null)} />
  }

  return (
    <section className="view inbox-view">
      <header className="view-head">
        <div className="view-titles">
          <h1>Untagged</h1>
          <p className="view-sub">
            {isLoading && !library
              ? 'Loading…'
              : untagged.length === 0
                ? 'Every song has a tag'
                : `${untagged.length} ${untagged.length === 1 ? 'song' : 'songs'} without a tag · ${formatLongDuration(totalSeconds)} · newest first`}
          </p>
        </div>
        {untagged.length > 0 && (
          <div className="view-actions">
            <button
              type="button"
              className="button button-primary"
              onClick={() => setSession(untagged.map(song => song.id))}
            >
              <Play size={15} /> Start tagging
            </button>
          </div>
        )}
      </header>

      {untagged.length > 0 && (
        <p className="inbox-lead hint">
          {isMobile
            ? 'One song at a time: it plays while you tap its tags, then Next.'
            : 'One song at a time: it plays while you pick tags with the number keys, then → for the next.'}
        </p>
      )}

      {untagged.length === 0 && library ? (
        <div className="empty-state">
          <p className="empty-emoji">🏷️</p>
          <h2>All tagged</h2>
          <p className="hint">Every song in your library carries at least one tag.</p>
          <div className="empty-actions">
            <Link className="button" to="/">
              Back to the library
            </Link>
          </div>
        </div>
      ) : (
        <div className="song-list" role="table" aria-label="Untagged songs">
          {untagged.map((song, index) => (
            <SongRow
              key={song.id}
              song={song}
              index={index}
              tagById={tagById}
              isCurrent={player.current?.id === song.id}
              isPlaying={player.playing}
              selected={false}
              onPlay={() => player.playFrom(untagged, index)}
              onToggleTag={() => undefined}
              showIndex={!isMobile}
            />
          ))}
        </div>
      )}
    </section>
  )
}

/**
 * One song at a time.
 *
 * The list of songs is fixed when tagging starts, so a song you tag does not
 * vanish from under you, and Back returns to it. Tags keep the order they had
 * when you started — most used first — so the number for "chill" is the same
 * on the fortieth song as on the first.
 */
function Triage({ ids, onExit }: { ids: readonly number[]; onExit: () => void }) {
  const { data: library } = useLibrary()
  const player = usePlayer()
  const isMobile = useIsMobile()
  const setSongTags = useSetSongTags()
  const createTag = useCreateTag()

  const [index, setIndex] = useState(0)
  const [finished, setFinished] = useState(false)
  const [newTag, setNewTag] = useState('')
  const [playAlong, setPlayAlongState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(PLAY_ALONG_KEY) !== 'false'
    } catch {
      return true
    }
  })
  /** What this session set on each song, so a chip flips before the refetch lands. */
  const [applied, setApplied] = useState<ReadonlyMap<number, ReadonlySet<number>>>(() => new Map())
  const newTagRef = useRef<HTMLInputElement>(null)

  const tags = useMemo(() => library?.tags ?? [], [library])
  const tagById = useMemo(() => new Map(tags.map(tag => [tag.id, tag])), [tags])
  const songById = useMemo(
    () => new Map((library?.songs ?? []).map(song => [song.id, song])),
    [library],
  )
  // A song deleted mid-session just drops out.
  const queue = useMemo(
    () => ids.map(id => songById.get(id)).filter((song): song is Song => song !== undefined),
    [ids, songById],
  )

  const [order, setOrder] = useState<readonly number[]>(() =>
    [...tags]
      .sort((a, b) => b.songCount - a.songCount || a.name.localeCompare(b.name))
      .map(t => t.id),
  )
  const orderedTags = useMemo<Tag[]>(() => {
    const known = order.map(id => tagById.get(id)).filter((tag): tag is Tag => tag !== undefined)
    const added = tags.filter(tag => !order.includes(tag.id))
    return [...known, ...added]
  }, [order, tags, tagById])

  const safeIndex = Math.min(index, Math.max(0, queue.length - 1))
  const song = queue[safeIndex]
  const current = song ? (applied.get(song.id) ?? new Set(song.tagIds)) : new Set<number>()

  const setPlayAlong = (on: boolean): void => {
    setPlayAlongState(on)
    try {
      localStorage.setItem(PLAY_ALONG_KEY, String(on))
    } catch {
      // Private browsing; lasts for this session.
    }
  }

  const toggle = useCallback(
    (tagId: number) => {
      if (!song) return
      const base = applied.get(song.id) ?? new Set(song.tagIds)
      const next = new Set(base)
      if (next.has(tagId)) next.delete(tagId)
      else next.add(tagId)
      setApplied(map => new Map(map).set(song.id, next))
      setSongTags.mutate({ songId: song.id, tagIds: [...next] })
    },
    [song, applied, setSongTags],
  )

  const next = useCallback(() => {
    if (safeIndex >= queue.length - 1) setFinished(true)
    else setIndex(safeIndex + 1)
  }, [safeIndex, queue.length])

  const back = useCallback(() => {
    setFinished(false)
    setIndex(Math.max(0, safeIndex - 1))
  }, [safeIndex])

  // Play along: the card and the player move together. The guard on the id is
  // what stops the two effects below from chasing each other.
  const queueRef = useRef(queue)
  queueRef.current = queue
  const playFromRef = useRef(player.playFrom)
  playFromRef.current = player.playFrom
  const currentIdRef = useRef(player.current?.id)
  currentIdRef.current = player.current?.id
  const songId = song?.id
  useEffect(() => {
    if (!playAlong || finished || songId === undefined) return
    if (currentIdRef.current === songId) return
    const position = queueRef.current.findIndex(item => item.id === songId)
    if (position >= 0) playFromRef.current(queueRef.current, position)
    // Only a new card restarts playback — not every player tick, which is why
    // the player is reached through refs rather than listed here.
  }, [songId, playAlong, finished])

  // …and when a song ends on its own and the next one starts, follow it.
  const playingId = player.current?.id
  useEffect(() => {
    if (!playAlong || playingId === undefined) return
    const position = queueRef.current.findIndex(item => item.id === playingId)
    if (position >= 0) setIndex(position)
  }, [playingId, playAlong])

  const create = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    const name = newTag.trim()
    if (!name || !song) return
    const existing = tags.find(tag => tag.name.toLowerCase() === name.toLowerCase())
    setNewTag('')
    if (existing) {
      if (!current.has(existing.id)) toggle(existing.id)
      return
    }
    const tag = await createTag.mutateAsync(name)
    setOrder(list => [...list, tag.id])
    const nextSet = new Set(current).add(tag.id)
    setApplied(map => new Map(map).set(song.id, nextSet))
    setSongTags.mutate({ songId: song.id, tagIds: [...nextSet] })
  }

  // Keys. Registered in the capture phase so they win over the app-wide ones —
  // → is "skip five seconds" everywhere else, "next song" here.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        if (event.key === 'Escape') target.blur()
        return
      }
      if (target instanceof HTMLElement && target.closest('[role="dialog"], [role="menu"]')) return

      let handled = true
      if (/^[1-9]$/.test(event.key)) {
        const tag = orderedTags[Number(event.key) - 1]
        if (tag) toggle(tag.id)
      } else if (event.key === 'ArrowRight' || event.key === 'Enter') {
        if (finished) onExit()
        else next()
      } else if (event.key === 'ArrowLeft') {
        back()
      } else if (event.key === 'n' || event.key === '/') {
        newTagRef.current?.focus()
      } else if (event.key === 'Escape') {
        onExit()
      } else {
        handled = false
      }

      if (handled) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [orderedTags, toggle, next, back, finished, onExit])

  if (queue.length === 0 || finished) {
    const tagged = queue.filter(item => (applied.get(item.id)?.size ?? item.tagIds.length) > 0)
    return (
      <section className="view triage-view">
        <div className="empty-state">
          <p className="empty-emoji">🏷️</p>
          <h2>
            {queue.length === 0
              ? 'Nothing left to tag'
              : `Tagged ${tagged.length} of ${queue.length}`}
          </h2>
          <p className="hint">
            {queue.length - tagged.length > 0
              ? `${queue.length - tagged.length} still untagged — they stay in the list for next time.`
              : 'Every song you went through has a tag now.'}
          </p>
          <div className="empty-actions">
            {queue.length > 0 && (
              <button type="button" className="button" onClick={back}>
                Back to the last song
              </button>
            )}
            <button type="button" className="button button-primary" onClick={onExit}>
              <Check size={15} /> Done
            </button>
          </div>
        </div>
      </section>
    )
  }

  if (!song) return null
  const progress = ((safeIndex + 1) / queue.length) * 100

  return (
    <section className="view triage-view" aria-label="Tag untagged songs">
      <header className="triage-head">
        <button type="button" className="button" onClick={onExit}>
          <X size={15} /> <span className="button-label">Done</span>
        </button>
        <span className="triage-count">
          {safeIndex + 1} <span className="hint">of {queue.length}</span>
        </span>
        <label className="triage-play-along">
          <input
            type="checkbox"
            className="toggle"
            checked={playAlong}
            onChange={event => setPlayAlong(event.target.checked)}
          />
          <span>Play along</span>
        </label>
      </header>

      <div
        className="triage-progress"
        role="progressbar"
        aria-valuenow={safeIndex + 1}
        aria-valuemin={1}
        aria-valuemax={queue.length}
        aria-label="Songs gone through"
      >
        <span style={{ width: `${progress}%` }} />
      </div>

      <div className="triage-card">
        <Cover song={song} size={isMobile ? 132 : 176} />
        <div className="triage-meta">
          <h1 className="triage-title">{song.title}</h1>
          <p className="triage-artist">
            {song.artist || 'Unknown artist'}
            {song.album && <span className="triage-album"> · {song.album}</span>}
          </p>
          {song.features && (
            <p className="triage-features">
              <FeatureBadges features={song.features} size="large" />
            </p>
          )}
          {!playAlong && (
            <button
              type="button"
              className="button button-small"
              onClick={() => player.playFrom(queue, safeIndex)}
            >
              <Play size={13} /> Play this one
            </button>
          )}
        </div>
      </div>

      <div className="triage-tags" role="group" aria-label={`Tags for ${song.title}`}>
        {orderedTags.length === 0 && (
          <p className="hint">No tags yet — type one below to create it and put it on this song.</p>
        )}
        {orderedTags.map((tag, position) => {
          const on = current.has(tag.id)
          return (
            <button
              key={tag.id}
              type="button"
              className={`triage-tag ${on ? 'is-on' : ''}`}
              style={{ '--tag-hue': tag.hue } as React.CSSProperties}
              aria-pressed={on}
              onClick={() => toggle(tag.id)}
            >
              {!isMobile && position < 9 && <kbd>{position + 1}</kbd>}
              {on ? <Check size={13} /> : null}
              {tag.name}
            </button>
          )
        })}
        <form className="triage-new" onSubmit={event => void create(event)}>
          <Plus size={14} />
          <input
            ref={newTagRef}
            value={newTag}
            onChange={event => setNewTag(event.target.value)}
            placeholder={isMobile ? 'New tag' : 'New tag (N)'}
            aria-label="Create a tag and add it to this song"
            spellCheck={false}
            autoComplete="off"
            maxLength={40}
          />
        </form>
      </div>

      <footer className="triage-foot">
        <button type="button" className="button" onClick={back} disabled={safeIndex === 0}>
          ← Back
        </button>
        {!isMobile && (
          <span className="hint triage-keys">
            <kbd>1</kbd>–<kbd>9</kbd> tags · <kbd>→</kbd> next · <kbd>Esc</kbd> done
          </span>
        )}
        <button type="button" className="button button-primary" onClick={next}>
          {safeIndex >= queue.length - 1 ? (
            <>
              <Check size={15} /> Finish
            </>
          ) : (
            <>
              {current.size === 0 ? 'Skip' : 'Next'} <ChevronRight size={15} />
            </>
          )}
        </button>
      </footer>

      <p className="triage-foot-note hint">
        <Inbox size={13} /> Songs you skip stay in Untagged.
      </p>
    </section>
  )
}
