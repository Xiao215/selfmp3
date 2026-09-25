import type { ImportRequestView } from '@selfmp3/replica'
import { youtubeVideoId, youtubeWatchUrl, type ImportJob } from '@selfmp3/shared'
import type { Handlers, PageRequest, PillState } from '../bridge.js'

/**
 * What the pill on a YouTube page is told (B1).
 *
 * The narrow half of the worker: a content script hands over a link and gets
 * back what to draw. It never learns the server's address, its token, your tags
 * or your playlists — an import from the pill takes your defaults, as the
 * right-click item does.
 */

const idle: PillState = { state: 'idle', progress: null, jobId: null, message: null }

/**
 * How a job in the queue reads to the pill. A job still waiting its turn is
 * `queued`, not `importing`: a long queue is an hour of turning ring on a
 * page that could have been left, and the badge and the notification are
 * what follow it once the page is gone.
 */
export function stateOfJob(job: ImportJob): PillState {
  if (job.status === 'queued') {
    return { state: 'queued', progress: null, jobId: job.id, message: null }
  }
  if (job.status === 'running') {
    return {
      state: 'importing',
      progress: job.step === 'downloading' ? job.progress : null,
      jobId: job.id,
      message: null,
    }
  }
  if (job.status === 'done') return { state: 'added', progress: null, jobId: null, message: null }
  if (job.status === 'error') {
    return { state: 'failed', progress: null, jobId: null, message: job.error ?? 'Failed' }
  }
  return idle
}

/**
 * How a link left in the bucket reads to the pill (I3).
 *
 * There is no percentage and no step: the server says how each request went in
 * the snapshot it writes, and until it has taken this one there is nothing to
 * report but that it is waiting.
 */
export function stateOfRequest(request: ImportRequestView): PillState {
  if (request.state === 'waiting' || request.state === 'working') {
    return { state: 'waiting', progress: null, jobId: null, message: null }
  }
  if (request.state === 'done')
    return { state: 'added', progress: null, jobId: null, message: null }
  if (request.state === 'failed') {
    return { state: 'failed', progress: null, jobId: null, message: request.error ?? 'Failed' }
  }
  return idle
}

export function createPageHandler(handlers: Handlers) {
  /** The job for this video, whichever form of link it was queued under. */
  async function jobFor(videoId: string): Promise<ImportJob | null> {
    const queue = await handlers.queue({ type: 'queue' })
    return queue.jobs.find(job => youtubeVideoId(job.url) === videoId) ?? null
  }

  /** The request for this video in the bucket, whichever form of link it was left under. */
  async function requestFor(videoId: string): Promise<ImportRequestView | null> {
    const { imports } = await handlers.requests({ type: 'requests' })
    return imports.find(each => youtubeVideoId(each.url) === videoId) ?? null
  }

  return async function handle(request: PageRequest): Promise<PillState> {
    const videoId = youtubeVideoId(request.url)
    if (!videoId) return idle
    const url = youtubeWatchUrl(videoId)
    const viaBucket = (await handlers.status({ type: 'status' })).mode === 'bucket'

    if (request.type === 'pillState') {
      const hit = await handlers.songFor({ type: 'songFor', url })
      if (hit) return { state: 'have', progress: null, jobId: null, message: null }
      if (viaBucket) {
        const waiting = await requestFor(videoId)
        return waiting ? stateOfRequest(waiting) : idle
      }
      const job = await jobFor(videoId)
      return job ? stateOfJob(job) : idle
    }

    /*
     * pillImport: your defaults, no questions — the server adds the default
     * tags itself, so nothing about your library crosses into the page.
     *
     * Through the bucket there is no reading the link first, because only the
     * server can read it: the link goes in as it is and the server works out
     * what it holds when it takes it.
     */
    // With the tags the last import from the popup went in with: tagging is
    // chosen once there, and the pill carries it from song to song. The page
    // still learns nothing — the ids go from the worker to the server.
    const { lastTagIds } = await handlers.choices({ type: 'choices' })
    if (viaBucket) {
      return stateOfRequest(
        await handlers.requestImport({ type: 'requestImport', url, tagIds: lastTagIds }),
      )
    }
    const preview = await handlers.preview({ type: 'preview', url })
    const items = preview.items.filter(item => !item.alreadyHave)
    if (items.length === 0) return { state: 'have', progress: null, jobId: null, message: null }
    const result = await handlers.enqueue({
      type: 'enqueue',
      request: { items, tagIds: lastTagIds, playlistId: null, createPlaylistName: null },
      label: null,
    })
    const job = result.jobs[0]
    return job ? stateOfJob(job) : idle
  }
}
