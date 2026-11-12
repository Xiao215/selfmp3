import { clockIn, linkKindName } from '@selfmp3/client'
import type { ImportJob, ImportPacing, Tag } from '@selfmp3/shared'

/* What the import queue's rows say, with nothing drawn (ImportQueue.tsx). */

/** A job's title, or before one was found, what kind of link it is (AB1). */
export function jobName(job: Pick<ImportJob, 'title' | 'url'>): string {
  return job.title || linkKindName(job.url)
}

/** "In your library · tagged night drive": where a finished song went, and how. */
export function arrivedLine(job: ImportJob, tags: readonly Tag[]): string {
  const names = tags.filter(tag => job.tagIds.includes(tag.id)).map(tag => tag.name)
  return names.length > 0 ? `In your library · tagged ${names.join(', ')}` : 'In your library'
}

/**
 * "Starts in 0:38" under the song whose turn is next. The queue goes at the
 * pace YouTube allows this address (services/ytThrottle.ts) — signed out, a
 * song most of a minute — and the server says how long until the next may
 * go, so the wait is counted down rather than drawn as a download at 0 %.
 * The server's own wait already holds a rate-limit pause, when one is on.
 */
export function nextLine(pacing: ImportPacing): string {
  if (pacing.waitMs <= 0) return 'Next'
  const why = pacing.pausedUntil !== null ? 'YouTube asked us to slow down' : 'pacing YouTube'
  return `Starts in ${clockIn(pacing.waitMs)} · ${why}`
}
