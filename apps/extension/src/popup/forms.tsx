import { reviewFrom, type Review } from '@selfmp3/client/core'
import {
  formatDuration,
  type ImportEnqueue,
  type ImportPreview,
  type ImportPreviewItem,
  type Tag,
} from '@selfmp3/shared'
import { useState, type KeyboardEvent, type ReactNode } from 'react'
import type { Choices } from '../bridge.js'
import { AddTag, ErrorLine, TagChip } from '../ui/parts.js'
import {
  countLabel,
  comingIn,
  hostOf,
  importLabel,
  listRequest,
  renameSong,
  rowState,
  songNote,
  songRequest,
  toggleId,
  toggleLeftOut,
  type RowState,
} from './popup.model.js'
import { Cover, SongLine, State } from './views.js'

/**
 * The popup's forms (docs/ui-mock `E1`–`E3`): one song, a list, and a link
 * left for a server that is asleep, each with the tags to import it under.
 * The states around them, and the pieces both draw with, are views.tsx's.
 */

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
function usePicked(tagging: Tagging): [ReadonlySet<number>, (id: number) => void] {
  const [own, setOwn] = useState<ReadonlySet<number> | null>(null)
  const picked = own ?? new Set(tagging.choices?.lastTagIds ?? [])
  return [picked, id => setOwn(toggleId(picked, id))]
}

/**
 * The tags to add (`E1`): every tag as a dot chip and "+ new". Never a
 * playlist.
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
  const pick = (id: number): void => {
    if (!picked.has(id)) onToggle(id)
  }
  const chips = choices ? (
    <>
      {choices.tags.map(tag => (
        <TagChip key={tag.id} tag={tag} on={picked.has(tag.id)} onToggle={() => onToggle(tag.id)} />
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
      <ErrorLine message={tagging.error} />
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
  const [picked, togglePicked] = usePicked(tagging)

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
      <TagPicker heading="Tag it" tagging={tagging} picked={picked} onToggle={togglePicked} />
      <ErrorLine message={error} />
      <button
        type="button"
        className="commit"
        disabled={pending || !title.trim()}
        onClick={() => onImport(songRequest(item, { title, artist }, picked), null)}
      >
        <DownloadMark />
        {pending ? 'Importing…' : 'Import to your library'}
      </button>
    </>
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
  state: RowState
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
  const [picked, togglePicked] = usePicked(tagging)
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
        onToggle={togglePicked}
      />
      <ErrorLine message={error} />
      <button
        type="button"
        className="commit"
        disabled={pending || count === 0}
        onClick={() => onImport(listRequest(review, picked), review.playlistTitle)}
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
  noServer,
  onOpenApp,
  onRequest,
}: {
  link: string
  /** A playlist, an album or an artist rather than one song. */
  list: boolean
  /**
   * The bucket names no server at all, so none will wake to take this until
   * self.mp3 is opened and connects one (connection.ts).
   */
  noServer: boolean
  onOpenApp: () => void
  /** The tab's own title, which is all anyone here knows about the link. */
  title: string | null
  tagging: Tagging
  pending: boolean
  error: string | null
  onRequest: (input: { tagIds: number[] }) => void
}): ReactNode {
  const [picked, togglePicked] = usePicked(tagging)

  return (
    <>
      {noServer ? (
        <State
          line={<SongLine cover={null} title={title ?? hostOf(link)} artist="" />}
          title="No computer works for your library yet"
          actions={
            <button type="button" className="tonal" onClick={onOpenApp}>
              Open self.mp3
            </button>
          }
        >
          <p>
            Open self.mp3 once to connect one. The link is kept in your storage until then, and
            imports itself once one is connected.
          </p>
        </State>
      ) : (
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
      )}
      <TagPicker heading="Tag it" tagging={tagging} picked={picked} onToggle={togglePicked} />
      <ErrorLine message={error} />
      <button
        type="button"
        className="commit"
        disabled={pending}
        onClick={() => onRequest({ tagIds: [...picked] })}
      >
        {pending ? 'Keeping it…' : 'Keep it for later'}
      </button>
    </>
  )
}
