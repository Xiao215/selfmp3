import { jobSubtitle } from '@selfmp3/client/core'
import type { ImportRequestView } from '@selfmp3/replica'
import {
  youtubeVideoId,
  type ImportJob,
  type ImportPreview,
  type ImportPreviewItem,
} from '@selfmp3/shared'
import type { SongHit, Status } from '../bridge.js'
import { importable, type PageKind } from '../pageKind.js'

/**
 * The popup, without the drawing: what it shows for what it knows.
 *
 * Whether a server answers, the link (the tab's, or one pasted), whether the
 * library already has that song, what the server read at the link, and a job
 * for it — and exactly one state comes out, in the order docs/features/browser-extension.md
 * ("The popup, state by state") lists them.
 */

/**
 * Which of the two ways in is live (I3).
 *
 * `ready` is the server itself, and only it can read a link. `bucket` is the
 * link left for the server to take when it wakes: everything the popup can
 * still offer, and nothing it cannot.
 */
export type Connection = 'checking' | 'none' | 'away' | 'ready' | 'bucket'

export function connectionOf(status: Status): Connection {
  switch (status.mode) {
    case 'server':
      return 'ready'
    case 'bucket':
      return 'bucket'
    case 'away':
      return 'away'
    default:
      return 'none'
  }
}

export type PreviewState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'done'; readonly value: ImportPreview }

export interface PopupInputs {
  readonly connection: Connection
  readonly link: string | null
  /** The link was pasted, rather than the tab's. */
  readonly typed: boolean
  readonly page: PageKind
  /** The song the library already has from this video; `loading` while that is asked. */
  readonly hit: SongHit | null | 'loading'
  readonly preview: PreviewState
  readonly job: ImportJob | null
  /** The link already left in the bucket, in bucket mode. */
  readonly request: ImportRequestView | null
  readonly importAnyway: boolean
}

type PopupView =
  | { readonly name: 'checking' }
  | { readonly name: 'connect' }
  | { readonly name: 'away' }
  | { readonly name: 'paste' }
  | { readonly name: 'looking' }
  | { readonly name: 'importing'; readonly job: ImportJob }
  | { readonly name: 'added'; readonly job: ImportJob }
  | { readonly name: 'failed'; readonly message: string; readonly jobId: string | null }
  | {
      readonly name: 'have'
      readonly title: string
      readonly artist: string
      readonly hit: SongHit | null
      readonly cover: string | null
    }
  | { readonly name: 'song'; readonly item: ImportPreviewItem }
  /** A playlist, an album or an artist: the whole list, to tick through (C). */
  | { readonly name: 'list'; readonly preview: ImportPreview }
  /**
   * Through the bucket: the link, with nothing read from it. A list is the same
   * form with different words — the server takes the whole thing and skips what
   * the library already has.
   */
  | { readonly name: 'request'; readonly link: string; readonly list: boolean }
  /** Left in the bucket, not taken yet. */
  | { readonly name: 'waiting'; readonly request: ImportRequestView }
  /** The server took it and it landed. */
  | { readonly name: 'requested'; readonly request: ImportRequestView }

/** Whether to ask the server about the link: a YouTube song or list, or anything pasted. */
export function shouldLookUp(page: PageKind, typed: boolean): boolean {
  return typed || importable(page)
}

export function popupView(input: PopupInputs): PopupView {
  if (input.connection === 'checking') return { name: 'checking' }
  if (input.connection === 'none') return { name: 'connect' }
  if (input.connection === 'away') return { name: 'away' }
  if (input.connection === 'bucket') return bucketView(input)

  const { job } = input
  if (job) {
    if (job.status === 'queued' || job.status === 'running') return { name: 'importing', job }
    if (job.status === 'done') return { name: 'added', job }
    if (job.status === 'error') return { name: 'failed', message: jobSubtitle(job), jobId: job.id }
    // Cancelled: back to the song, to import or not.
  }

  if (!input.link || !shouldLookUp(input.page, input.typed)) return { name: 'paste' }

  if (input.hit === 'loading') return { name: 'looking' }
  if (input.hit && !input.importAnyway) {
    const { title, artist } = input.hit
    return { name: 'have', title, artist, hit: input.hit, cover: null }
  }

  const { preview } = input
  if (preview.status === 'idle' || preview.status === 'loading') return { name: 'looking' }
  if (preview.status === 'error') return { name: 'failed', message: preview.message, jobId: null }

  const { value } = preview
  if (value.kind === 'playlist') return { name: 'list', preview: value }
  const item = value.items[0]
  if (!item)
    return { name: 'failed', message: 'There is nothing to import at this link.', jobId: null }
  if (item.alreadyHave && !input.importAnyway) {
    return {
      name: 'have',
      title: item.title,
      artist: item.artist,
      hit: null,
      cover: item.thumbnail,
    }
  }
  return { name: 'song', item }
}

/**
 * The same popup with the server away: no preview, no ticking through a list,
 * and nothing editable — because only the server can read a link at all
 * (docs/features/browser-extension.md, "The two paths do not offer the same things").
 *
 * What is lost is the looking, not the importing. A link left here is fetched
 * the next time the server is awake (SYNC.md, rule 6), which is why this is a
 * state of its own rather than the "your server isn't answering" wall.
 */
function bucketView(input: PopupInputs): PopupView {
  const { request } = input
  if (request) {
    if (request.state === 'waiting' || request.state === 'working')
      return { name: 'waiting', request }
    if (request.state === 'done') return { name: 'requested', request }
    if (request.state === 'failed') {
      return {
        name: 'failed',
        message: request.error ?? 'Your server could not fetch that link.',
        jobId: null,
      }
    }
    // Called off: back to the link, to leave again or not.
  }

  if (!input.link || !shouldLookUp(input.page, input.typed)) return { name: 'paste' }
  if (input.hit === 'loading') return { name: 'looking' }
  if (input.hit && !input.importAnyway) {
    const { title, artist } = input.hit
    return { name: 'have', title, artist, hit: input.hit, cover: null }
  }
  return { name: 'request', link: input.link, list: input.page.kind !== 'song' }
}

/** The request already left for this link, matched by video as the queue is. */
export function requestForLink(
  requests: readonly ImportRequestView[],
  link: string | null,
): ImportRequestView | null {
  if (!link) return null
  const videoId = youtubeVideoId(link)
  const matches = requests.filter(request =>
    videoId ? youtubeVideoId(request.url) === videoId : request.url === link,
  )
  return (
    matches.find(request => request.state === 'waiting' || request.state === 'working') ??
    matches.find(request => request.state !== 'cancelled') ??
    null
  )
}

/** A server's `2026-09-14 08:30:00` is UTC without saying so; an ISO time says so. */
function stampTime(stamp: string): number {
  return new Date(stamp.includes('T') ? stamp : `${stamp.replace(' ', 'T')}Z`).getTime()
}

/** How long a finished import is still news when the popup opens again. */
const RECENT_MS = 10 * 60_000

/**
 * The import job for the link, if the popup should be about it: one started
 * from this popup, one still going, or one that finished in the last few
 * minutes. Matched by video, since the same song is queued under more than one
 * form of link.
 */
export function jobForLink(
  jobs: readonly ImportJob[],
  link: string | null,
  startedHere: ReadonlySet<string>,
  now: Date,
): ImportJob | null {
  if (!link) return null
  const videoId = youtubeVideoId(link)
  const matches = jobs.filter(job =>
    videoId ? youtubeVideoId(job.url) === videoId : job.url === link,
  )
  return (
    matches.find(job => startedHere.has(job.id)) ??
    matches.find(job => job.status === 'queued' || job.status === 'running') ??
    matches.find(
      job => job.status !== 'cancelled' && now.getTime() - stampTime(job.updatedAt) < RECENT_MS,
    ) ??
    null
  )
}

/**
 * An import started here whose songs are not the page's: a playlist's tracks,
 * ticked through and sent from the list (C). Their links are the songs' own, so
 * `jobForLink` never finds them — the popup follows the first that is still
 * going, and says how many landed once they have all finished.
 */
export function batchProgress(
  jobs: readonly ImportJob[],
  startedHere: ReadonlySet<string>,
): { job: ImportJob; total: number; added: number } | null {
  const mine = jobs.filter(job => startedHere.has(job.id))
  if (mine.length === 0) return null
  const going = mine.find(job => job.status === 'queued' || job.status === 'running')
  const job = going ?? mine.find(each => each.status === 'done') ?? mine[0]
  if (!job) return null
  return { job, total: mine.length, added: mine.filter(each => each.status === 'done').length }
}

/** A tab's title without YouTube's name on the end or its unread count in front. */
export function pageTitle(raw: string | null | undefined): string | null {
  const text = (raw ?? '')
    .replace(/^\(\d+\)\s*/, '')
    .replace(/\s*-\s*YouTube(?: Music)?$/, '')
    .trim()
  return text || null
}

/** The video's own title, when the server tidied it into something else. */
export function cleanedFrom(page: string | null, title: string): string | null {
  if (!page) return null
  return page.trim().toLowerCase() === title.trim().toLowerCase() ? null : page
}

const DAY_MONTH = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})
const DAY_MONTH_YEAR = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

/** "In your library since 12 Aug · played 41 times". */
export function sinceLine(hit: SongHit, now: Date): string {
  const added = new Date(stampTime(hit.addedAt))
  const date =
    added.getUTCFullYear() === now.getUTCFullYear()
      ? DAY_MONTH.format(added)
      : DAY_MONTH_YEAR.format(added)
  const plays =
    hit.playCount === 0
      ? 'not played yet'
      : hit.playCount === 1
        ? 'played once'
        : `played ${hit.playCount} times`
  return `In your library since ${date} · ${plays}`
}

/** A download with its percentage; every other step by its name. */
export function progressLine(job: ImportJob): { text: string; fraction: number | null } {
  if (job.status === 'running' && job.step === 'downloading' && job.progress !== null) {
    return { text: `Downloading · ${Math.round(job.progress)}%`, fraction: job.progress / 100 }
  }
  return { text: jobSubtitle(job), fraction: null }
}

/** `http://localhost:4600` as the header pill writes it. */
export function hostOf(baseUrl: string): string {
  return baseUrl.replace(/^https?:\/\//, '')
}
