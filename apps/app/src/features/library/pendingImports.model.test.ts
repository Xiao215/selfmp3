import { describe, expect, it } from 'vitest'
import { linkThumbnail, pendingImports } from './pendingImports.model'

const request = (patch: Partial<Parameters<typeof pendingImports>[0][number]>) => ({
  uid: 'r1',
  url: 'https://www.youtube.com/watch?v=dGZqpVCJP3k',
  state: 'waiting' as const,
  title: null,
  songIds: [],
  error: null,
  requestedAt: '2026-09-13T10:00:00.000Z',
  ...patch,
})

describe('pending imports in a cloud library', () => {
  it('works out a YouTube video’s thumbnail from its link, and nothing for a playlist', () => {
    expect(linkThumbnail('https://youtu.be/dGZqpVCJP3k')).toBe(
      'https://i.ytimg.com/vi/dGZqpVCJP3k/mqdefault.jpg',
    )
    expect(linkThumbnail('https://music.youtube.com/playlist?list=PL123')).toBeNull()
  })

  it('shows waiting, downloading and failed requests, newest first, titled by the link until looked up', () => {
    const rows = pendingImports(
      [
        request({
          uid: 'old',
          state: 'working',
          title: '群青',
          requestedAt: '2026-09-13T09:00:00.000Z',
        }),
        request({ uid: 'new' }),
        request({
          uid: 'bad',
          state: 'failed',
          error: 'Private video',
          requestedAt: '2026-09-13T08:00:00.000Z',
        }),
      ],
      new Set(),
    )
    expect(rows.map(row => row.uid)).toEqual(['new', 'old', 'bad'])
    expect(rows[0]).toMatchObject({
      title: 'https://www.youtube.com/watch?v=dGZqpVCJP3k',
      status: 'Waiting for your server',
    })
    expect(rows[1]).toMatchObject({
      title: '群青',
      status: 'Downloading on your server…',
      failed: false,
    })
    expect(rows[2]).toMatchObject({ status: 'Couldn’t import it: Private video', failed: true })
  })

  it('keeps a finished request until its songs are in the library, and never shows a cancelled one', () => {
    const done = request({ uid: 'done', state: 'done', songIds: [7, 8] })
    expect(pendingImports([done], new Set([7])).map(row => row.status)).toEqual([
      'Almost ready: uploading to your library',
    ])
    expect(pendingImports([done], new Set([7, 8]))).toEqual([])
    expect(pendingImports([request({ state: 'cancelled' })], new Set())).toEqual([])
  })
})
