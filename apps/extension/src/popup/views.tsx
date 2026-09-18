import {
  chosenItems,
  enqueueRequest,
  hasLink,
  importButtonLabel,
  jobAction,
  linkHint,
  queueActivity,
  reviewFrom,
  reviewHeading,
  toggleChosen,
  type Review,
} from '@selfmp3/client/core'
import type { ImportRequestView } from '@selfmp3/replica'
import {
  extractUrls,
  formatDuration,
  type ImportEnqueue,
  type ImportJob,
  type ImportPreview,
  type ImportPreviewItem,
  type ImportQueue,
  type Tag,
} from '@selfmp3/shared'
import { useState, type CSSProperties, type ReactNode } from 'react'
import type { Choices } from '../bridge.js'
import { hostOf, progressLine, type Connection } from './popup.model.js'

/** The pieces the popup is drawn from, each a state of docs/features/browser-extension.md's table. */

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
      {/* Which way in is live, in the header rather than in every state (I3). */}
      {connection === 'bucket' ? (
        <span className="conn bucket">
          <span className="dot" aria-hidden="true" />
          Via your bucket
        </span>
      ) : (
        baseUrl && (
          <span className={connection === 'ready' ? 'conn' : 'conn away'}>
            <span className="dot" aria-hidden="true" />
            {hostOf(baseUrl)}
          </span>
        )
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
      <p>
        Sign in with Google, and links can wait in your bucket while your server is off. Or point
        the extension straight at your server’s address.
      </p>
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
        Importing goes through your self.mp3 server. Turn it on, check its address in the options —
        or sign in with Google there, and links can wait in your bucket instead.
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

function toggleId(ids: ReadonlySet<number>, id: number): ReadonlySet<number> {
  const next = new Set(ids)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

/** Everything a form sends: the tags always added, and the ones you picked. */
function tagIdsFor(choices: Choices | undefined, picked: ReadonlySet<number>): Set<number> {
  return new Set([...(choices?.defaultTagIds ?? []), ...picked])
}

function TagChips({
  choices,
  picked,
  onToggle,
}: {
  choices: Choices | undefined
  picked: ReadonlySet<number>
  onToggle: (id: number) => void
}): ReactNode {
  const defaults = new Set(choices?.defaultTagIds ?? [])
  return (
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
              onToggle={() => onToggle(tag.id)}
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
  )
}

function PlaylistSelect({
  choices,
  value,
  onChange,
}: {
  choices: Choices | undefined
  value: number | null
  onChange: (id: number | null) => void
}): ReactNode {
  return (
    <label className="field">
      <span>Add to playlist</span>
      <select
        id="playlist"
        value={value ?? ''}
        onChange={event => onChange(event.target.value ? Number(event.target.value) : null)}
      >
        <option value="">No playlist</option>
        {(choices?.playlists ?? []).map(list => (
          <option key={list.id} value={list.id}>
            {list.name}
          </option>
        ))}
      </select>
    </label>
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
  onImport: (request: ImportEnqueue, label: string | null) => void
}): ReactNode {
  const [title, setTitle] = useState(item.title)
  const [artist, setArtist] = useState(item.artist)
  const [picked, setPicked] = useState<ReadonlySet<number>>(() => new Set())
  const [playlistId, setPlaylistId] = useState<number | null>(null)

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
      <TagChips
        choices={choices}
        picked={picked}
        onToggle={id => setPicked(toggleId(picked, id))}
      />
      <PlaylistSelect choices={choices} value={playlistId} onChange={setPlaylistId} />
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
            enqueueRequest(
              {
                items: [{ ...item, title: title.trim(), artist: artist.trim() }],
                chosen: new Set([0]),
                playlistTitle: null,
              },
              { tagIds: tagIdsFor(choices, picked), playlistId, createPlaylist: false },
            ),
            null,
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

export function Added({
  job,
  count,
  onOpen,
}: {
  job: ImportJob
  /** How many songs landed, when the import was of several. */
  count?: number
  onOpen: () => void
}): ReactNode {
  return (
    <>
      <SongCard cover={job.thumbnail} title={job.title} artist={job.artist} />
      <p className="banner good">
        {count !== undefined && count > 1
          ? `${count} songs added to your library`
          : 'Added to your library'}
      </p>
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

/** How many of a list's songs the popup has room for before it says "+ N more". */
const SHOWN = 8

/**
 * A playlist, an album or an artist (C): every song it holds, the ones you
 * already have unticked, and the playlist it came from offered as a new one.
 */
export function ListReview({
  preview,
  choices,
  pending,
  error,
  onImport,
  onOpenFull,
}: {
  preview: ImportPreview
  choices: Choices | undefined
  pending: boolean
  error: string | null
  onImport: (request: ImportEnqueue, label: string | null) => void
  onOpenFull: () => void
}): ReactNode {
  const [review, setReview] = useState<Review>(() => reviewFrom(preview))
  const [picked, setPicked] = useState<ReadonlySet<number>>(() => new Set())
  const [playlistId, setPlaylistId] = useState<number | null>(null)
  const [alsoCreate, setAlsoCreate] = useState(false)
  const heading = reviewHeading(review)
  const chosen = chosenItems(review).length

  return (
    <>
      <SongCard
        cover={null}
        title={review.playlistTitle ?? 'A list of songs'}
        artist={heading.duplicates ? `${heading.found} · ${heading.duplicates}` : heading.found}
      />
      <ul className="picks">
        {review.items.slice(0, SHOWN).map((item, index) => (
          <li key={item.url}>
            <label className="pick">
              <input
                type="checkbox"
                checked={review.chosen.has(index)}
                onChange={() =>
                  setReview({ ...review, chosen: toggleChosen(review.chosen, index) })
                }
              />
              <span className="pick-name">
                <span className="row-title">{item.title}</span>
                <span className="row-sub">{item.artist}</span>
              </span>
              {item.alreadyHave && <span className="tagh">have</span>}
            </label>
          </li>
        ))}
      </ul>
      {review.items.length > SHOWN && (
        <p className="hint">
          + {review.items.length - SHOWN} more ·{' '}
          <button type="button" className="link" onClick={onOpenFull}>
            Open the full review
          </button>
        </p>
      )}
      {review.playlistTitle && playlistId === null && (
        <label className="pick">
          <input
            type="checkbox"
            checked={alsoCreate}
            onChange={event => setAlsoCreate(event.target.checked)}
          />
          <span>Also create playlist “{review.playlistTitle}”</span>
        </label>
      )}
      <TagChips
        choices={choices}
        picked={picked}
        onToggle={id => setPicked(toggleId(picked, id))}
      />
      <PlaylistSelect choices={choices} value={playlistId} onChange={setPlaylistId} />
      {error && (
        <p className="banner bad" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="primary"
        disabled={pending || chosen === 0}
        onClick={() =>
          onImport(
            enqueueRequest(review, {
              tagIds: tagIdsFor(choices, picked),
              playlistId,
              createPlaylist: alsoCreate,
            }),
            review.playlistTitle,
          )
        }
      >
        {pending ? 'Importing…' : importButtonLabel(chosen)}
      </button>
    </>
  )
}

/**
 * The link, with nothing read from it (I3).
 *
 * There is no title to correct and no track list to tick through, because
 * reading a link is the server's alone — it is what runs yt-dlp. The tags and
 * the playlist still work, because those are this device's own copy of the
 * library and go into the bucket beside the link.
 */
export function RequestForm({
  link,
  list,
  title,
  choices,
  pending,
  error,
  onRequest,
}: {
  link: string
  /** A playlist, an album or an artist rather than one song. */
  list: boolean
  /** The tab's own title, which is all anyone here knows about the link. */
  title: string | null
  choices: Choices | undefined
  pending: boolean
  error: string | null
  onRequest: (input: { tagIds: number[]; playlistId: number | null }) => void
}): ReactNode {
  const [picked, setPicked] = useState<ReadonlySet<number>>(() => new Set())
  const [playlistId, setPlaylistId] = useState<number | null>(null)

  return (
    <>
      <SongCard cover={null} title={title ?? link} artist="" detail={hostOf(link)} />
      <p className="note">
        {list
          ? 'Your server takes the whole list when it wakes, and skips what you already have.'
          : 'Your server will read the details when it fetches this.'}
      </p>
      <TagChips
        choices={choices}
        picked={picked}
        onToggle={id => setPicked(toggleId(picked, id))}
      />
      <PlaylistSelect choices={choices} value={playlistId} onChange={setPlaylistId} />
      {error && (
        <p className="banner bad" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="primary"
        disabled={pending}
        onClick={() => onRequest({ tagIds: [...tagIdsFor(choices, picked)], playlistId })}
      >
        {pending ? 'Adding…' : 'Add when the server wakes'}
      </button>
    </>
  )
}

/** Left in the bucket and not taken yet: the sentence from the mock, and a way out of it. */
export function Waiting({
  request,
  title,
  cancelling,
  onCancel,
}: {
  request: ImportRequestView
  title: string | null
  cancelling: boolean
  onCancel: () => void
}): ReactNode {
  return (
    <>
      <SongCard cover={null} title={request.title ?? title ?? request.url} artist="" />
      <p className="banner good" aria-live="polite">
        {request.state === 'working'
          ? 'Your server is fetching it now.'
          : 'Waiting for your server. It downloads it the next time it is awake, and it arrives after the sync that follows.'}
      </p>
      <button type="button" className="secondary" disabled={cancelling} onClick={onCancel}>
        Don’t bother
      </button>
    </>
  )
}

/** The server took it while nobody was looking, and it landed. */
export function Requested({
  request,
  onOpen,
}: {
  request: ImportRequestView
  onOpen: () => void
}): ReactNode {
  return (
    <>
      <SongCard cover={null} title={request.title ?? request.url} artist="" />
      <p className="banner good">
        {request.songIds.length > 1
          ? `${request.songIds.length} songs added to your library`
          : 'Added to your library'}
      </p>
      <button type="button" className="secondary" onClick={onOpen}>
        Open in self.mp3
      </button>
    </>
  )
}

/** The footer in bucket mode: what is still waiting for the server, rather than a queue. */
export function BucketFooter({
  waiting,
  onOpen,
}: {
  waiting: number
  onOpen: () => void
}): ReactNode {
  return (
    <footer className="foot">
      <span>
        {waiting === 0
          ? 'Nothing waiting'
          : waiting === 1
            ? '1 link waiting for your server'
            : `${waiting} links waiting for your server`}
      </span>
      <button type="button" className="link" onClick={onOpen}>
        Queue
      </button>
    </footer>
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
