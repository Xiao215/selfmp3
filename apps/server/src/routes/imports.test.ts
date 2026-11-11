import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ErrorBodySchema, ImportEnqueueResultSchema } from '@selfmp3/shared'
import type { Container } from '../container.js'
import { startLibrary, type TestLibrary } from '../fixtures/library.js'
import { newSong } from '../fixtures/songs.js'

/**
 * The import routes through the real app and a real database: what a link may
 * make the server fetch, and what is refused before anything is queued. The
 * queue is stopped, so nothing queued here is downloaded.
 */
describe('import routes', () => {
  let library: TestLibrary
  let container: Container

  beforeAll(async () => {
    library = await startLibrary()
    container = library.container
    container.importQueue.stop()
  })

  afterAll(() => library.close())

  const errorOf = async (response: Response): Promise<string> =>
    ErrorBodySchema.parse(await response.json()).error

  it('plays only a YouTube or 网易云 link, and looks nothing up for another', async () => {
    const source = vi.spyOn(container.listen, 'source')
    try {
      for (const url of [
        'http://127.0.0.1:4600/api/health',
        'http://169.254.169.254/latest/meta-data/',
        'https://youtube.com.example.org/watch?v=dQw4w9WgXcQ',
      ]) {
        const response = await library.send(
          'GET',
          `/api/import/listen?url=${encodeURIComponent(url)}`,
        )
        expect(response.status, url).toBe(400)
        expect(await errorOf(response)).toBe('only YouTube and 网易云 links can be played')
      }
      expect(source).not.toHaveBeenCalled()
    } finally {
      source.mockRestore()
    }
  })

  it('reads the colour only of a cover from YouTube’s or 网易云’s picture hosts', async () => {
    const tone = vi.spyOn(container.previewCoverTones, 'tone')
    try {
      for (const url of [
        'http://127.0.0.1:4600/cover.jpg',
        // The right host, over plain HTTP.
        'http://i.ytimg.com/vi/x/hqdefault.jpg',
        'https://i.ytimg.com.example.org/vi/x/hqdefault.jpg',
      ]) {
        const response = await library.send(
          'GET',
          `/api/import/cover-tone?url=${encodeURIComponent(url)}`,
        )
        expect(response.status, url).toBe(400)
      }
      expect(tone).not.toHaveBeenCalled()
    } finally {
      tone.mockRestore()
    }
  })

  it('refuses a song the library has under another spelling of its link, making no playlist', async () => {
    container.songs.insert(
      newSong({ title: 'Kept', sourceUrl: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' }),
    )
    const playlists = container.playlists.all().length

    const response = await library.send('POST', '/api/import/enqueue', {
      items: [{ url: 'https://youtu.be/aaaaaaaaaaa' }],
      createPlaylistName: 'From the link',
    })

    expect(response.status).toBe(409)
    expect(container.playlists.all()).toHaveLength(playlists)
    expect(container.imports.counts().queued).toBe(0)
  })

  it('queues what is new once, and skips it while it waits', async () => {
    const first = await library.send('POST', '/api/import/enqueue', {
      items: [{ url: 'https://youtu.be/bbbbbbbbbbb' }, { url: 'https://youtu.be/ccccccccccc' }],
    })
    expect(first.status).toBe(200)
    expect(ImportEnqueueResultSchema.parse(await first.json())).toMatchObject({
      skipped: 0,
      playlistId: null,
    })

    const again = await library.send('POST', '/api/import/enqueue', {
      items: [
        { url: 'https://www.youtube.com/watch?v=bbbbbbbbbbb' },
        { url: 'https://youtu.be/ddddddddddd' },
      ],
    })
    expect(again.status).toBe(200)
    const answer = ImportEnqueueResultSchema.parse(await again.json())
    expect(answer.skipped).toBe(1)
    expect(answer.jobs.map(job => job.url)).toEqual(['https://youtu.be/ddddddddddd'])
    expect(container.imports.counts().queued).toBe(3)
  })

  it('names a job by its id only', async () => {
    expect((await library.send('POST', '/api/import/jobs/1/cancel')).status).toBe(400)
    const unknown = '00000000-0000-4000-8000-000000000000'
    expect((await library.send('POST', `/api/import/jobs/${unknown}/cancel`)).status).toBe(409)
  })
})
