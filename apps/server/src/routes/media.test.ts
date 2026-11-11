import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startLibrary, type TestLibrary } from '../fixtures/library.js'
import { newSong } from '../fixtures/songs.js'

/**
 * Cover art from a data directory inside a hidden folder.
 *
 * `res.sendFile` refuses any path with a dot-segment unless told otherwise, and
 * answered 404 for every cover: the server's own default data directory on
 * Linux is `~/.local/share/selfmp3`, and a test lane's was `~/.selfmp3-lanes/…`.
 */
describe('GET /api/art/:id', () => {
  let library: TestLibrary

  beforeAll(async () => {
    library = await startLibrary({
      // Under a hidden folder, as the server's own default on Linux is.
      env: root => ({ SELFMP3_DATA_DIR: path.join(root, '.hidden', 'data') }),
    })
    const cover = await sharp({
      create: { width: 300, height: 300, channels: 3, background: '#2040c0' },
    })
      .png()
      .toBuffer()
    // A cover is found by the format its song's row recorded, so the song is there first.
    expect(library.container.songs.insert(newSong({ title: 'A' }))).toBe(1)
    await library.container.covers.save(1, cover, '.png')
  })

  afterAll(() => library.close())

  const get = (url: string): Promise<Response> => library.send('GET', url)

  it('serves the cover itself', async () => {
    const response = await get('/api/art/1')
    expect(response.status).toBe(200)
    // Saved as a PNG, kept as a JPEG (squareCover.ts).
    expect(response.headers.get('content-type')).toContain('image/jpeg')
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0)
  })

  it('serves a thumbnail made beside it', async () => {
    const response = await get('/api/art/1?size=64')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('image/jpeg')
  })

  /*
   * Setting the week-long cache header before the file is sent means a failure
   * carries it too: the desktop app's cache keeps a 404 for every cover and
   * goes on serving itself that after the server can answer.
   */
  it('does not let a cover that failed to send be cached', async () => {
    // Found by name, but a directory: the send itself fails.
    fs.mkdirSync(path.join(library.container.config.dataDir, 'covers', '2.png'), {
      recursive: true,
    })
    const response = await get('/api/art/2')
    expect(response.status).not.toBe(200)
    // Without a max-age a browser keeps no failure; Express's own weak ETag on
    // the JSON error body does not change that.
    expect(response.headers.get('cache-control') ?? '').not.toContain('max-age')
  })
})
