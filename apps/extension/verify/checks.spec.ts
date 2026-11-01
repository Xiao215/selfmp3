import { expect, test } from '@playwright/test'
import { startFakeServer, TOKEN, type FakeServer } from './fakeServer.js'
import { HELLO_URL, IDOL_URL } from './fixtures.js'
import { extensionPage, launchExtension, type LaunchedExtension } from './launch.js'

/**
 * The green checks on song rows, against a YouTube Music page of our own
 * served at music.youtube.com: the real content script, the real page-world
 * script and the real worker, with Up next rows whose videos live only in
 * their Polymer data, as on the live page.
 *
 * The fixture library holds Hello and not Idol.
 */

test.describe.configure({ mode: 'serial' })

let server: FakeServer
let extension: LaunchedExtension

const MINE = new URL(HELLO_URL).searchParams.get('v') ?? ''
const NOT_MINE = new URL(IDOL_URL).searchParams.get('v') ?? ''

/** Up next as YouTube Music draws it: no links, the video only in `data`, set by the page. */
const PLAYER_PAGE = `<!doctype html>
<html><body>
  <div id="queue"></div>
  <script>
    function row(videoId) {
      const item = document.createElement('ytmusic-player-queue-item')
      item.innerHTML =
        '<div class="song-info"><span class="song-title">A song</span></div>' +
        '<span class="duration">4:01</span>'
      item.data = { videoId }
      return item
    }
    document.getElementById('queue').append(row('${MINE}'), row('${NOT_MINE}'))
    // What Polymer does when the queue moves on: the same row, another song.
    window.reuseFirstRow = videoId => {
      const item = document.querySelector('ytmusic-player-queue-item')
      item.data = { videoId }
      item.querySelector('.song-title').textContent = 'Another song'
    }
  </script>
</body></html>`

test.beforeAll(async () => {
  server = await startFakeServer()
  extension = await launchExtension()
  await extension.context.route('https://music.youtube.com/**', route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: PLAYER_PAGE }),
  )
})

test.afterAll(async () => {
  await extension?.close()
  await server?.close()
})

test('connect the extension first', async () => {
  const page = await extension.context.newPage()
  await page.goto(extensionPage('options.html'))
  await page.getByText('Connect by address instead').click()
  await page.getByLabel('Address').fill(server.url)
  await page.getByRole('button', { name: 'Use this address' }).click()
  await page.getByLabel('Token').fill(TOKEN)
  await page.getByRole('button', { name: 'Use this address' }).click()
  await expect(page.getByText(`Pointed at ${server.url}`)).toBeVisible()
  await page.close()
})

test('an Up next row that is yours gets a check, and one that is not does not', async () => {
  const page = await extension.context.newPage()
  await page.goto('https://music.youtube.com/explore')
  const rows = page.locator('ytmusic-player-queue-item')
  await expect(rows.nth(0).locator('selfmp3-check')).toHaveCount(1)
  await expect(rows.nth(1)).toHaveAttribute('data-selfmp3-videos', NOT_MINE)
  await expect(rows.nth(1).locator('selfmp3-check')).toHaveCount(0)
  // Before the duration.
  expect(
    await rows
      .nth(0)
      .locator('selfmp3-check')
      .evaluate(check => check.nextElementSibling?.className),
  ).toBe('duration')

  // The row is reused for a song that is not yours: the check goes.
  await page.evaluate(
    id => (window as unknown as { reuseFirstRow(id: string): void }).reuseFirstRow(id),
    NOT_MINE,
  )
  await expect(rows.nth(0).locator('selfmp3-check')).toHaveCount(0)
  await page.close()
})
