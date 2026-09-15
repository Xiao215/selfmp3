import { hasLink, jobAction, linkHint, queueActivity } from '@selfmp3/client/core'
import {
  extractUrls,
  formatDuration,
  type ImportJob,
  type ImportPreviewItem,
  type ImportQueue,
  type Tag,
} from '@selfmp3/shared'
import { useState, type CSSProperties, type ReactNode } from 'react'
import type { Choices } from '../bridge.js'
import { hostOf, progressLine, type Connection } from './popup.model.js'

/** The pieces the popup is drawn from, each a state of docs/EXTENSION.md's table. */

function Gear(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  )
}

export function Header({
  baseUrl,
  connection,
  onOptions,
}: {
  baseUrl: string | null
  connection: Connection
  onOptions: () => void
}): ReactNode {
  return (
    <header className="head">
      <span className="logo">
        self<i>.</i>mp3
      </span>
      {baseUrl && (
        <span className={connection === 'ready' ? 'conn' : 'conn away'}>
          <span className="dot" aria-hidden="true" />
          {hostOf(baseUrl)}
        </span>
      )}
      <button type="button" className="icon" aria-label="Options" onClick={onOptions}>
        <Gear />
      </button>
    </header>
  )
}

function Cover({ src }: { src: string | null }): ReactNode {
  return src ? (
    <img className="cover" src={src} alt="" />
  ) : (
    <div className="cover blank" aria-hidden="true" />
  )
}

function SongCard({
  cover,
  title,
  artist,
  detail,
}: {
  cover: string | null
  title: string
  artist: string
  detail?: string
}): ReactNode {
  return (
    <div className="card-song">
      <Cover src={cover} />
      <div>
        <div className="song-title">{title}</div>
        {artist && <div className="song-artist">{artist}</div>}
        {detail && <div className="song-detail">{detail}</div>}
      </div>
    </div>
  )
}

export function Checking(): ReactNode {
  return <p className="quiet">Checking your server…</p>
}

export function Connect({ onOptions }: { onOptions: () => void }): ReactNode {
  return (
    <div className="empty">
      <h1>Connect to your library</h1>
      <p>The extension imports through your self.mp3 server. Tell it where that is.</p>
      <button type="button" className="primary" onClick={onOptions}>
        Open options
      </button>
    </div>
  )
}

export function Away({
  onRetry,
  onOptions,
}: {
  onRetry: () => void
  onOptions: () => void
}): ReactNode {
  return (
    <div className="empty">
      <h1>Your server isn’t answering</h1>
      <p>
        Importing goes through your self.mp3 server. Turn it on, or check its address in the
        options.
      </p>
      <div className="actions">
        <button type="button" className="primary" onClick={onRetry}>
          Try again
        </button>
        <button type="button" className="secondary" onClick={onOptions}>
          Options
        </button>
      </div>
    </div>
  )
}

export function Looking({ title }: { title: string | null }): ReactNode {
  return (
    <>
      <div className="card-song" aria-busy="true">
        <div className="cover blank" aria-hidden="true" />
        <div>
          {title ? <div className="song-title">{title}</div> : <div className="skeleton" />}
        </div>
      </div>
      <p className="quiet">Reading the link…</p>
    </>
  )
}

export function Paste({
  recent,
  onLookUp,
}: {
  recent: readonly ImportJob[]
  onLookUp: (link: string) => void
}): ReactNode {
  const [text, setText] = useState('')
  const link = extractUrls(text, 1)[0] ?? null
  const hint = linkHint(text)
  return (
    <>
      <label className="field">
        <span>Paste a link</span>
        <textarea
          id="paste"
          rows={3}
          value={text}
          placeholder="music.youtube.com/watch?v=…"
          onChange={event => setText(event.target.value)}
        />
      </label>
      {hint && <p className="hint">{hint}</p>}
      <button
        type="button"
        className="primary"
        disabled={!hasLink(text)}
        onClick={() => link && onLookUp(link)}
      >
        Look up
      </button>
      {recent.length > 0 && (
        <section className="recent">
          <h2>Imported recently</h2>
          <ul>
            {recent.map(job => (
              <li key={job.id} className="row">
                {job.thumbnail ? (
                  <img className="cover small" src={job.thumbnail} alt="" />
                ) : (
                  <div className="cover small blank" aria-hidden="true" />
                )}
                <div>
                  <div className="row-title">{job.title}</div>
                  <div className="row-sub">{job.artist}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

function TagChip({
  tag,
  on,
  fixed,
  onToggle,
}: {
  tag: Tag
  on: boolean
  fixed: boolean
  onToggle: () => void
}): ReactNode {
  return (
    <button
      type="button"
      className="chip"
      aria-pressed={on}
      disabled={fixed}
      onClick={onToggle}
      style={{ '--hue': String(tag.hue) } as CSSProperties}
    >
      <span className="swatch" aria-hidden="true" />
      {tag.name}
    </button>
  )
}

export function SongForm({
  item,
  cleanedFrom,
  choices,
  pending,
  error,
  onImport,
}: {
  item: ImportPreviewItem
  cleanedFrom: string | null
  choices: Choices | undefined
  pending: boolean
  error: string | null
  onImport: (item: ImportPreviewItem, tagIds: number[], playlistId: number | null) => void
}): ReactNode {
  const [title, setTitle] = useState(item.title)
  const [artist, setArtist] = useState(item.artist)
  const [picked, setPicked] = useState<ReadonlySet<number>>(() => new Set())
  const [playlistId, setPlaylistId] = useState<number | null>(null)
  const defaults = new Set(choices?.defaultTagIds ?? [])

  const toggle = (id: number): void => {
    const next = new Set(picked)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setPicked(next)
  }

  return (
    <>
      <SongCard
        cover={item.thumbnail}
        title={title.trim() || item.title}
        artist={artist}
        detail={item.duration > 0 ? formatDuration(item.duration) : undefined}
      />
      {cleanedFrom && (
        <p className="note">
          Cleaned from <s>{cleanedFrom}</s>
        </p>
      )}
      <div className="two">
        <label className="field">
          <span>Title</span>
          <input id="title" value={title} onChange={event => setTitle(event.target.value)} />
        </label>
        <label className="field">
          <span>Artist</span>
          <input id="artist" value={artist} onChange={event => setArtist(event.target.value)} />
        </label>
      </div>
      <fieldset className="tags">
        <legend>Tags</legend>
        {choices ? (
          <div className="chips">
            {choices.tags.map(tag => (
              <TagChip
                key={tag.id}
                tag={tag}
                on={defaults.has(tag.id) || picked.has(tag.id)}
                fixed={defaults.has(tag.id)}
                onToggle={() => toggle(tag.id)}
              />
            ))}
          </div>
        ) : (
          <div className="skeleton" />
        )}
        {defaults.size > 0 && (
          <p className="hint">Tags from Settings → Importing are always added.</p>
        )}
      </fieldset>
      <label className="field">
        <span>Add to playlist</span>
        <select
          id="playlist"
          value={playlistId ?? ''}
          onChange={event => setPlaylistId(event.target.value ? Number(event.target.value) : null)}
        >
          <option value="">No playlist</option>
          {(choices?.playlists ?? []).map(list => (
            <option key={list.id} value={list.id}>
              {list.name}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p className="banner bad" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="primary"
        disabled={pending || !title.trim()}
        onClick={() =>
          onImport(
            { ...item, title: title.trim(), artist: artist.trim() },
            [...defaults, ...picked],
            playlistId,
          )
        }
      >
        {pending ? 'Importing…' : 'Import'}
      </button>
    </>
  )
}

export function Importing({
  job,
  cancelling,
  onCancel,
}: {
  job: ImportJob
  cancelling: boolean
  onCancel: () => void
}): ReactNode {
  const line = progressLine(job)
  return (
    <>
      <SongCard cover={job.thumbnail} title={job.title} artist={job.artist} />
      <div
        className="bar"
        role="progressbar"
        aria-label="Import progress"
        aria-valuenow={line.fraction === null ? undefined : Math.round(line.fraction * 100)}
      >
        {line.fraction === null ? (
          <b className="busy" />
        ) : (
          <b style={{ width: `${line.fraction * 100}%` }} />
        )}
      </div>
      <p className="step">{line.text}</p>
      {jobAction(job) === 'cancel' && (
        <button type="button" className="secondary" disabled={cancelling} onClick={onCancel}>
          Cancel
        </button>
      )}
    </>
  )
}

export function Added({ job, onOpen }: { job: ImportJob; onOpen: () => void }): ReactNode {
  return (
    <>
      <SongCard cover={job.thumbnail} title={job.title} artist={job.artist} />
      <p className="banner good">Added to your library</p>
      <button type="button" className="secondary" onClick={onOpen}>
        Open in self.mp3
      </button>
    </>
  )
}

export function Failed({
  message,
  canRetry,
  retrying,
  onRetry,
}: {
  message: string
  canRetry: boolean
  retrying: boolean
  onRetry: () => void
}): ReactNode {
  return (
    <>
      <p className="banner bad" role="alert">
        {message}
      </p>
      <button type="button" className="secondary" disabled={retrying} onClick={onRetry}>
        {canRetry ? 'Retry' : 'Try again'}
      </button>
    </>
  )
}

export function Have({
  title,
  artist,
  cover,
  line,
  onOpen,
  onImportAnyway,
}: {
  title: string
  artist: string
  cover: string | null
  line: string
  onOpen: () => void
  onImportAnyway: () => void
}): ReactNode {
  return (
    <>
      <SongCard cover={cover} title={title} artist={artist} />
      <p className="banner good">{line}</p>
      <div className="actions even">
        <button type="button" className="secondary" onClick={onOpen}>
          Open in self.mp3
        </button>
        <button type="button" className="secondary" onClick={onImportAnyway}>
          Import anyway
        </button>
      </div>
    </>
  )
}

export function List({
  title,
  count,
  have,
  onReview,
}: {
  title: string | null
  count: number
  have: number
  onReview: () => void
}): ReactNode {
  const songs = `${count} ${count === 1 ? 'song' : 'songs'}`
  return (
    <>
      <SongCard
        cover={null}
        title={title ?? 'A list of songs'}
        artist={have > 0 ? `${songs} · ${have} already in your library` : songs}
      />
      <button type="button" className="primary" onClick={onReview}>
        Open the full review
      </button>
    </>
  )
}

export function QueueFooter({
  queue,
  onOpen,
}: {
  queue: ImportQueue | undefined
  onOpen: () => void
}): ReactNode {
  return (
    <footer className="foot">
      <span>{(queue && queueActivity(queue)) ?? 'Nothing importing'}</span>
      <button type="button" className="link" onClick={onOpen}>
        Queue
      </button>
    </footer>
  )
}
