import { hasLink, jobAction, linkHint, queueActivity } from '@selfmp3/client/core'
import type { ImportRequestView } from '@selfmp3/replica'
import { extractUrls, plural, type ImportJob, type ImportQueue } from '@selfmp3/shared'
import { useState, type ReactNode } from 'react'
import { ErrorLine, Logo } from '../ui/parts.js'
import { connectionLabel, hostOf, progressLine, type Connection } from './popup.model.js'

/**
 * The pieces the popup is drawn from (docs/ui-mock `E1`–`E3`), each a state of
 * docs/features/browser-extension.md's table. 360 wide, on the ground, with a
 * card one tone up where there is something to hold. The forms that import
 * something are forms.tsx's, drawn with the pieces exported here.
 */

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

export function Cover({ src, small }: { src: string | null; small?: boolean }): ReactNode {
  const className = small ? 'cover small' : 'cover'
  return src ? (
    <img className={className} src={src} alt="" />
  ) : (
    <div className={`${className} blank`} aria-hidden="true" />
  )
}

/** The song a state is about, as one quiet line over the words (`E3`). */
export function SongLine({
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
export function State({
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
  return <p className="quiet">Finding your library…</p>
}

export function Connect({ onOptions }: { onOptions: () => void }): ReactNode {
  return (
    <State
      title="Save songs from any page"
      actions={
        // Signing in runs in the options page: a sign-in window closes the
        // popup, and the answer would come back to nobody.
        <button type="button" className="primary" onClick={onOptions}>
          Sign in with Google
        </button>
      }
    >
      <p>Sign in with the account your library uses.</p>
    </State>
  )
}

/**
 * A typed-in address that did not answer, and no account. Sign-in leads: it
 * is what finds the server, and a dead address from the options page reads as
 * a server that is down when the server is fine.
 */
export function SignedOut({
  baseUrl,
  onSignIn,
  onRetry,
}: {
  baseUrl: string | null
  onSignIn: () => void
  onRetry: () => void
}): ReactNode {
  return (
    <State
      title="Sign in to find your server"
      actions={
        <>
          <button type="button" className="primary" onClick={onSignIn}>
            Sign in with Google
          </button>
          <button type="button" className="tonal" onClick={onRetry}>
            Try again
          </button>
        </>
      }
    >
      <p>Sign in with the account your library uses, and the extension finds your server itself.</p>
      {baseUrl && (
        <p className="quiet">{hostOf(baseUrl)}, the address in the options, didn’t answer.</p>
      )}
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
      <ErrorLine message={message} />
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

/**
 * Left in the bucket and not taken yet, and a way out of it.
 *
 * With no server at all (`noServer`, as `RequestForm` has it) there is no
 * server to wait for, and saying so would promise a download nothing is going
 * to make: the link waits for a computer to be connected instead.
 */
export function Waiting({
  request,
  title,
  noServer,
  cancelling,
  onCancel,
}: {
  request: ImportRequestView
  title: string | null
  noServer: boolean
  cancelling: boolean
  onCancel: () => void
}): ReactNode {
  const unclaimed = noServer && request.state !== 'working'
  return (
    <State
      line={<SongLine cover={null} title={request.title ?? title ?? request.url} artist="" />}
      title={
        request.state === 'working'
          ? 'Your server is fetching it now'
          : unclaimed
            ? 'Kept for later'
            : 'Waiting for your server'
      }
      actions={
        <button type="button" className="tonal" disabled={cancelling} onClick={onCancel}>
          Don’t bother
        </button>
      }
    >
      <p aria-live="polite">
        {unclaimed
          ? 'No computer works for your library yet. Connect one in self.mp3 and it imports from there.'
          : 'It downloads it the next time it is awake, and it arrives after the sync that follows.'}
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
          : `${plural(waiting, 'link', 'links')} waiting for your server`
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
