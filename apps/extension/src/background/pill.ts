import { youtubeVideoId, type ImportJob } from '@selfmp3/shared'
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

/** How a job in the queue reads to the pill. */
export function stateOfJob(job: ImportJob): PillState {
  if (job.status === 'queued' || job.status === 'running') {
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

export function createPageHandler(handlers: Handlers) {
  /** The job for this video, whichever form of link it was queued under. */
  async function jobFor(videoId: string): Promise<ImportJob | null> {
    const queue = await handlers.queue({ type: 'queue' })
    return queue.jobs.find(job => youtubeVideoId(job.url) === videoId) ?? null
  }

  return async function handle(request: PageRequest): Promise<PillState> {
    const videoId = youtubeVideoId(request.url)
    if (!videoId) return idle
    const url = `https://www.youtube.com/watch?v=${videoId}`

    if (request.type === 'pillState') {
      const hit = await handlers.songFor({ type: 'songFor', url })
      if (hit) return { state: 'have', progress: null, jobId: null, message: null }
      const job = await jobFor(videoId)
      return job ? stateOfJob(job) : idle
    }

    // pillImport: your defaults, no questions — the server adds the default
    // tags itself, so nothing about your library crosses into the page.
    const preview = await handlers.preview({ type: 'preview', url })
    const items = preview.items.filter(item => !item.alreadyHave)
    if (items.length === 0) return { state: 'have', progress: null, jobId: null, message: null }
    const result = await handlers.enqueue({
      type: 'enqueue',
      request: { items, tagIds: [], playlistId: null, createPlaylistName: null },
      label: null,
    })
    const job = result.jobs[0]
    return job ? stateOfJob(job) : idle
  }
}
