import {
  hasLink,
  jobAction,
  linkHint,
  queueActivity,
  reviewFrom,
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
import { useState, type KeyboardEvent, type ReactNode } from 'react'
import type { Choices } from '../bridge.js'
import { AddTag, Logo, TagChip } from '../ui/parts.js'
import {
  chipState,
  connectionLabel,
  countLabel,
  comingIn,
  hostOf,
  importLabel,
  listRequest,
  progressLine,
  renameSong,
  rowState,
  songNote,
  songRequest,
  tagIdsFor,
  toggleId,
  toggleLeftOut,
  type Connection,
} from './popup.model.js'

/**
 * The pieces the popup is drawn from (docs/ui-mock `E1`–`E3`), each a state of
 * docs/features/browser-extension.md's table. 360 wide, on the ground, with a
 * card one tone up where there is something to hold.
 */

function Gear(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  )
}

function Pencil(): ReactNode {
  return (
    <svg className="pencil" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  )
}

function DownloadMark(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
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
  const label = connectionLabel(connection)
  return (
    <header className="head">
      <Logo />
      <span className="head-end">
        {/* Which way in is live, in the header rather than in every state (I3). */}
        {label && (
          <span className={`conn ${connection}`} title={baseUrl ? hostOf(baseUrl) : undefined}>
            <span className="dot" aria-hidden="true" />
            {label}
          </span>
        )}
        <button type="button" className="round" aria-label="Options" onClick={onOptions}>
          <Gear />
        </button>
      </span>
    </header>
  )
}

function Cover({ src, small }: { src: string | null; small?: boolean }): ReactNode {
  const className = small ? 'cover small' : 'cover'
  return src ? (
    <img className={className} src={src} alt="" />
  ) : (
    <div className={`${className} blank`} aria-hidden="true" />
  )
}

/** The song a state is about, as one quiet line over the words (`E3`). */
function SongLine({
  cover,
  title,
  artist,
}: {
  cover: string | null
  title: string
  artist: string
}): ReactNode {
  return (
    <div className="song-line">
      <Cover src={cover} small />
      <span>{artist ? `${title} · ${artist}` : title}</span>
    </div>
  )
}

/** A state: a heading, what it means, and what can be done about it (`E3`). */
function State({
  line,
  title,
  children,
  actions,
}: {
  line?: ReactNode
  title: string
  children?: ReactNode
  actions?: ReactNode
}): ReactNode {
  return (
    <section className="state">
      {line}
      <h1>{title}</h1>
      {children}
      {actions && <div className="actions">{actions}</div>}
    </section>
  )
}

export function Checking(): ReactNode {
  return <p className="quiet">Checking your server…</p>
}

export function Connect({ onOptions }: { onOptions: () => void }): ReactNode {
  return (
    <State
      title="Connect to your library"
      actions={
        <button type="button" className="primary" onClick={onOptions}>
          Set it up
        </button>
      }
    >
      <p>
        Sign in with the Google account your library uses, and links can wait in your bucket while
        your server is off. Or point the extension at your server’s address.
      </p>
    </State>
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
    <State
      title="Your server isn’t answering"
      actions={
        <>
          <button type="button" className="tonal" onClick={onRetry}>
            Try again
          </button>
          <button type="button" className="tonal" onClick={onOptions}>
            Options
          </button>
        </>
      }
    >
      <p>
        Importing goes through your self.mp3 server. Turn it on, check its address in the options —
        or sign in with Google there, and links can wait in your bucket instead.
      </p>
    </State>
  )
}

export function Looking({ title }: { title: string | null }): ReactNode {
  return (
    <section className="state" aria-busy="true">
      <div className="song-line">
        <div className="cover small blank" aria-hidden="true" />
        {title ? <span>{title}</span> : <div className="skeleton" />}
      </div>
      <p className="quiet">Reading the link…</p>
    </section>
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
      <State title="Nothing to import on this page">
        <p>
          Open a song, a playlist, an album or an artist on YouTube or YouTube Music, or paste a
          link here.
        </p>
      </State>
      <label className="field">
        <span className="label">Paste a link</span>
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
        className="tonal"
        disabled={!hasLink(text)}
        onClick={() => link && onLookUp(link)}
      >
        Look up
      </button>
      {recent.length > 0 && (
        <section className="recent">
          <h2 className="label">Imported recently</h2>
          <ul className="card rows">
            {recent.map(job => (
              <li key={job.id} className="row">
                <Cover src={job.thumbnail} small />
                <span className="row-name">
                  <span className="row-title">{job.title}</span>
                  <span className="row-sub">{job.artist}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

/** What every form needs for its tags: the choices, and a way to make a new one. */
export interface Tagging {
  readonly choices: Choices | undefined
  readonly creating: boolean
  readonly error: string | null
  /** Make a tag, and hand it back so the form can pick it. */
  create(name: string): Promise<Tag>
}

/**
 * A form's picks: the last import's tags once the choices say what those
 * were, and the person's own from the first touch. Tagging is chosen once
 * for a session of songs, not again on each.
 */
function usePicked(tagging: Tagging): [ReadonlySet<number>, (next: ReadonlySet<number>) => void] {
  const [own, setOwn] = useState<ReadonlySet<number> | null>(null)
  const picked = own ?? new Set(tagging.choices?.lastTagIds ?? [])
  return [picked, setOwn]
}

/**
 * The tags to add (`E1`): every tag as a dot chip, the ones the server adds
 * to every import already on, and "+ new". Never a playlist.
 */
function TagPicker({
  heading,
  tagging,
  picked,
  onToggle,
  inline,
}: {
  heading: string
  tagging: Tagging
  picked: ReadonlySet<number>
  onToggle: (id: number) => void
  /** The heading as the first thing in the row, as a list's `E2` has it. */
  inline?: boolean
}): ReactNode {
  const { choices } = tagging
  const defaults = choices?.defaultTagIds ?? []
  const pick = (id: number): void => {
    if (chipState(id, defaults, picked) === 'off') onToggle(id)
  }
  const chips = choices ? (
    <>
      {choices.tags.map(tag => (
        <TagChip
          key={tag.id}
          tag={tag}
          state={chipState(tag.id, defaults, picked)}
          onToggle={() => onToggle(tag.id)}
        />
      ))}
      <AddTag
        tags={choices.tags}
        pending={tagging.creating}
        onPick={pick}
        onCreate={name => {
          tagging.create(name).then(
            tag => pick(tag.id),
            () => undefined,
          )
        }}
      />
    </>
  ) : (
    <div className="skeleton" />
  )
  return (
    <div className="tags" role="group" aria-label={heading}>
      {inline ? (
        <div className="chips">
          <span className="tags-inline">{heading}</span>
          {chips}
        </div>
      ) : (
        <>
          <span className="label">{heading}</span>
          <div className="chips">{chips}</div>
        </>
      )}
      {defaults.length > 0 && (
        <p className="hint">Tags from Settings → Importing are always added.</p>
      )}
      {tagging.error && (
        <p className="error" role="alert">
          {tagging.error}
        </p>
      )}
    </div>
  )
}

/** A title or an artist, on the control surface, with its label inside (`E1`). */
function NameField({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
}): ReactNode {
  return (
    <div className="name-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} value={value} onChange={event => onChange(event.target.value)} />
      <Pencil />
    </div>
  )
}

/**
 * One song (`E1`): the title and the artist are fields before anything is
 * saved, tags can be added, and there is no playlist to choose.
 */
export function SongForm({
  item,
  cleanedFrom,
  tagging,
  pending,
  error,
  onImport,
}: {
  item: ImportPreviewItem
  cleanedFrom: string | null
  tagging: Tagging
  pending: boolean
  error: string | null
  onImport: (request: ImportEnqueue, label: string | null) => void
}): ReactNode {
  const [title, setTitle] = useState(item.title)
  const [artist, setArtist] = useState(item.artist)
  const [picked, setPicked] = usePicked(tagging)

  return (
    <>
      <div className="card song-card">
        <Cover src={item.thumbnail} />
        <div className="song-fields">
          <NameField id="title" label="Title" value={title} onChange={setTitle} />
          <NameField id="artist" label="Artist" value={artist} onChange={setArtist} />
          <p className="hint">{songNote(cleanedFrom, item.duration)}</p>
        </div>
      </div>
      <TagPicker
        heading="Tag it"
        tagging={tagging}
        picked={picked}
        onToggle={id => setPicked(toggleId(picked, id))}
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="commit"
        disabled={pending || !title.trim()}
        onClick={() =>
          onImport(
            songRequest(item, { title, artist }, tagIdsFor(tagging.choices?.defaultTagIds, picked)),
            null,
          )
        }
      >
        <DownloadMark />
        {pending ? 'Importing…' : 'Import to your library'}
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
    <State
      line={
        <>
          <SongLine cover={job.thumbnail} title={job.title} artist={job.artist} />
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
        </>
      }
      title={line.text}
      actions={
        jobAction(job) === 'cancel' && (
          <button type="button" className="tonal" disabled={cancelling} onClick={onCancel}>
            Cancel
          </button>
        )
      }
    >
      <p>
        You can close this. The toolbar badge counts what is left, and one notification says when
        the batch is done.
      </p>
    </State>
  )
}

export function Added({
  job,
  count,
  tagged,
  onOpen,
}: {
  job: ImportJob
  /** How many songs landed, when the import was of several. */
  count?: number
  /** "Tagged yoasobi.", when the import was tagged. */
  tagged: string | null
  onOpen: () => void
}): ReactNode {
  return (
    <State
      line={<SongLine cover={job.thumbnail} title={job.title} artist={job.artist} />}
      title={
        count !== undefined && count > 1
          ? `${count} songs added to your library`
          : 'Added to your library'
      }
      actions={
        <button type="button" className="tonal" onClick={onOpen}>
          Open in self.mp3
        </button>
      }
    >
      <p>{tagged ? `${tagged} ` : ''}It will be on your phone the next time it syncs.</p>
    </State>
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
    <State
      title="Couldn’t import this"
      actions={
        <button type="button" className="tonal" disabled={retrying} onClick={onRetry}>
          {canRetry ? 'Retry' : 'Try again'}
        </button>
      }
    >
      <p className="error" role="alert">
        {message}
      </p>
    </State>
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
    <State
      line={<SongLine cover={cover} title={title} artist={artist} />}
      title="Already in your library"
      actions={
        <>
          <button type="button" className="tonal" onClick={onOpen}>
            Open in self.mp3
          </button>
          <button type="button" className="link" onClick={onImportAnyway}>
            Import anyway
          </button>
        </>
      }
    >
      <p>{line}</p>
    </State>
  )
}

/** How many of a list's songs the popup has room for before it says "+ N more". */
const SHOWN = 8

/**
 * One row of a list (`E2`). The name is a button that becomes the title and
 * artist fields; the far end is a button that leaves the song out, or brings
 * it back. A song already in the library is dimmed and cannot be brought in.
 */
function ReviewRow({
  item,
  state,
  editing,
  onEdit,
  onDone,
  onRename,
  onToggle,
}: {
  item: ImportPreviewItem
  state: 'in' | 'yours' | 'out'
  editing: boolean
  onEdit: () => void
  onDone: () => void
  onRename: (rename: { title?: string; artist?: string }) => void
  onToggle: () => void
}): ReactNode {
  const keys = (event: KeyboardEvent): void => {
    if (event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault()
      onDone()
    }
  }
  return (
    <li className={state === 'in' ? 'review-row' : 'review-row dim'}>
      <Cover src={item.thumbnail} small />
      {editing ? (
        <span
          className="row-name editing"
          onBlur={event => {
            // Done when the focus leaves both fields, not when it moves between them.
            if (!event.currentTarget.contains(event.relatedTarget)) onDone()
          }}
        >
          <input
            aria-label="Title"
            className="edit-title"
            value={item.title}
            autoFocus
            onChange={event => onRename({ title: event.target.value })}
            onKeyDown={keys}
          />
          <input
            aria-label="Artist"
            className="edit-artist"
            value={item.artist}
            onChange={event => onRename({ artist: event.target.value })}
            onKeyDown={keys}
          />
        </span>
      ) : (
        <button type="button" className="row-name" onClick={onEdit}>
          <span className="row-title">{item.title}</span>
          <span className="row-sub">{item.artist}</span>
        </button>
      )}
      {state === 'yours' ? (
        <span className="row-end">Yours already</span>
      ) : (
        <button
          type="button"
          className={state === 'out' ? 'row-end out' : 'row-end'}
          aria-label={state === 'out' ? `Bring back ${item.title}` : `Leave out ${item.title}`}
          onClick={onToggle}
        >
          {state === 'out' ? 'Left out' : item.duration > 0 ? formatDuration(item.duration) : ''}
        </button>
      )}
    </li>
  )
}

/**
 * A playlist, an album or an artist (`E2`): every song coming in unless the far
 * end of its row is clicked, any name changed in place, tags for them all.
 * Never a playlist made of them — that is the app's to do, from songs you have.
 */
export function ListReview({
  preview,
  tagging,
  pending,
  error,
  onImport,
  onOpenFull,
}: {
  preview: ImportPreview
  tagging: Tagging
  pending: boolean
  error: string | null
  onImport: (request: ImportEnqueue, label: string | null) => void
  onOpenFull: () => void
}): ReactNode {
  const [review, setReview] = useState<Review>(() => reviewFrom(preview))
  const [editing, setEditing] = useState<number | null>(null)
  const [picked, setPicked] = usePicked(tagging)
  const count = comingIn(review)

  /** A name cleared to nothing goes back to what the link said, rather than importing blank. */
  const finish = (index: number): void => {
    const item = review.items[index]
    const original = preview.items[index]
    if (item && original) {
      setReview(
        renameSong(review, index, {
          title: item.title.trim() || original.title,
          artist: item.artist.trim(),
        }),
      )
    }
    setEditing(null)
  }

  return (
    <>
      <div className="list-head">
        <span className="list-name">{review.playlistTitle ?? 'A list of songs'}</span>
        <span className="list-count">{countLabel(review)}</span>
      </div>
      <p className="hint">
        Click a name to change it. Click the far end of a row to leave that song out.
      </p>
      <ul className="card rows">
        {review.items.slice(0, SHOWN).map((item, index) => (
          <ReviewRow
            key={item.url}
            item={item}
            state={rowState(review, index)}
            editing={editing === index}
            onEdit={() => setEditing(index)}
            onDone={() => finish(index)}
            onRename={rename => setReview(renameSong(review, index, rename))}
            onToggle={() => setReview(toggleLeftOut(review, index))}
          />
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
      <TagPicker
        heading="Tag them"
        inline
        tagging={tagging}
        picked={picked}
        onToggle={id => setPicked(toggleId(picked, id))}
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="commit"
        disabled={pending || count === 0}
        onClick={() =>
          onImport(
            listRequest(review, tagIdsFor(tagging.choices?.defaultTagIds, picked)),
            review.playlistTitle,
          )
        }
      >
        {pending ? 'Importing…' : importLabel(count)}
      </button>
    </>
  )
}

/**
 * The link, with nothing read from it, while the server sleeps (I3, `E3`).
 *
 * There is no title to correct and no track list to go through, because
 * reading a link is the server's alone — it is what runs yt-dlp. The tags
 * still work, because they are this device's own copy of the library and go
 * into the bucket beside the link.
 */
export function RequestForm({
  link,
  list,
  title,
  tagging,
  pending,
  error,
  onRequest,
}: {
  link: string
  /** A playlist, an album or an artist rather than one song. */
  list: boolean
  /** The tab's own title, which is all anyone here knows about the link. */
  title: string | null
  tagging: Tagging
  pending: boolean
  error: string | null
  onRequest: (input: { tagIds: number[] }) => void
}): ReactNode {
  const [picked, setPicked] = usePicked(tagging)

  return (
    <>
      <State
        line={<SongLine cover={null} title={title ?? hostOf(link)} artist="" />}
        title="Your server is asleep"
      >
        <p>
          {list
            ? 'The link is kept in your storage, and your server takes the whole list when it wakes — skipping what you already have.'
            : 'The link is kept in your storage and imports itself the next time the server wakes. Your server will read the details when it fetches this.'}
        </p>
      </State>
      <TagPicker
        heading="Tag it"
        tagging={tagging}
        picked={picked}
        onToggle={id => setPicked(toggleId(picked, id))}
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="commit"
        disabled={pending}
        onClick={() =>
          onRequest({ tagIds: [...tagIdsFor(tagging.choices?.defaultTagIds, picked)] })
        }
      >
        {pending ? 'Keeping it…' : 'Keep it for later'}
      </button>
    </>
  )
}

/** Left in the bucket and not taken yet, and a way out of it. */
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
    <State
      line={<SongLine cover={null} title={request.title ?? title ?? request.url} artist="" />}
      title={
        request.state === 'working' ? 'Your server is fetching it now' : 'Waiting for your server'
      }
      actions={
        <button type="button" className="tonal" disabled={cancelling} onClick={onCancel}>
          Don’t bother
        </button>
      }
    >
      <p aria-live="polite">
        It downloads it the next time it is awake, and it arrives after the sync that follows.
      </p>
    </State>
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
    <State
      line={<SongLine cover={null} title={request.title ?? request.url} artist="" />}
      title={
        request.songIds.length > 1
          ? `${request.songIds.length} songs added to your library`
          : 'Added to your library'
      }
      actions={
        <button type="button" className="tonal" onClick={onOpen}>
          Open in self.mp3
        </button>
      }
    >
      <p>It will be on your phone the next time it syncs.</p>
    </State>
  )
}

function Footer({ text, onOpen }: { text: string; onOpen: () => void }): ReactNode {
  return (
    <footer className="foot">
      <span className="dot" aria-hidden="true" />
      <span className="foot-text">{text}</span>
      <button type="button" className="link" onClick={onOpen}>
        Open the queue
      </button>
    </footer>
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
    <Footer
      text={
        waiting === 0
          ? 'Nothing waiting'
          : waiting === 1
            ? '1 link waiting for your server'
            : `${waiting} links waiting for your server`
      }
      onOpen={onOpen}
    />
  )
}

export function QueueFooter({
  queue,
  onOpen,
}: {
  queue: ImportQueue | undefined
  onOpen: () => void
}): ReactNode {
  return <Footer text={(queue && queueActivity(queue)) ?? 'Nothing importing'} onOpen={onOpen} />
}
