import { jobSubtitle } from '@selfmp3/client/core'
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
 * for it — and exactly one state comes out, in the order docs/EXTENSION.md
 * ("The popup, state by state") lists them.
 */

export type Connection = 'checking' | 'none' | 'away' | 'ready'

export function connectionOf(status: Status): Connection {
  if (!status.server) return 'none'
  return status.reachable ? 'ready' : 'away'
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
  readonly importAnyway: boolean
}

export type PopupView =
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
  | {
      readonly name: 'list'
      readonly title: string | null
      readonly count: number
      readonly have: number
    }

/** Whether to ask the server about the link: a YouTube song or list, or anything pasted. */
export function shouldLookUp(page: PageKind, typed: boolean): boolean {
  return typed || importable(page)
}

export function popupView(input: PopupInputs): PopupView {
  if (input.connection === 'checking') return { name: 'checking' }
  if (input.connection === 'none') return { name: 'connect' }
  if (input.connection === 'away') return { name: 'away' }

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
  if (value.kind === 'playlist') {
    return {
      name: 'list',
      title: value.playlistTitle,
      count: value.items.length,
      have: value.items.filter(item => item.alreadyHave).length,
    }
  }
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

/** A server's `2026-09-14 08:30:00` is UTC without saying so; an ISO time says so. */
function stampTime(stamp: string): number {
  return new Date(stamp.includes('T') ? stamp : `${stamp.replace(' ', 'T')}Z`).getTime()
}

/** How long a finished import is still news when the popup opens again. */
export const RECENT_MS = 10 * 60_000

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
