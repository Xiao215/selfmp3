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

/**
 * YouTube's Home as it was drawn on 2026-11-13: video cards, one of them a mix
 * whose link is a song of yours, and a search result drawn the older way.
 * Sized, so a mark has a corner to sit in.
 */
const card = (videoId: string, mix: boolean) => `
  <yt-lockup-view-model style="display:block;width:320px;margin:8px">
    <div class="ytLockupViewModelHost content-id-${videoId}">
      <a href="/watch?v=${videoId}&list=RD${videoId}&start_radio=1" class="ytLockupViewModelContentImage">
        ${mix ? '<yt-collection-thumbnail-view-model>' : ''}
        <yt-thumbnail-view-model style="display:block;position:relative;height:180px;background:#456"></yt-thumbnail-view-model>
        ${mix ? '</yt-collection-thumbnail-view-model>' : ''}
      </a>
    </div>
  </yt-lockup-view-model>`

const HOME_PAGE = `<!doctype html>
<html><body>
  <div id="grid">${card(MINE, false)}${card(NOT_MINE, false)}${card(MINE, true)}</div>
  <ytd-video-renderer style="display:block;width:360px">
    <ytd-thumbnail style="display:block;position:relative;height:200px">
      <a id="thumbnail" href="/watch?v=${MINE}&pp=ygUH" style="position:absolute;inset:0"></a>
    </ytd-thumbnail>
  </ytd-video-renderer>
</body></html>`

test.beforeAll(async () => {
  server = await startFakeServer()
  extension = await launchExtension()
  await extension.context.route('https://music.youtube.com/**', route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: PLAYER_PAGE }),
  )
  await extension.context.route('https://www.youtube.com/**', route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: HOME_PAGE }),
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

test('a video card that is yours gets the mark on its thumbnail, and a mix does not', async () => {
  const page = await extension.context.newPage()
  await page.goto('https://www.youtube.com/')
  const cards = page.locator('yt-lockup-view-model')
  await expect(cards.nth(0).locator('selfmp3-check')).toHaveCount(1)
  await expect(page.locator('ytd-video-renderer selfmp3-check')).toHaveCount(1)
  await expect(cards.nth(1).locator('selfmp3-check')).toHaveCount(0)
  await expect(cards.nth(2).locator('selfmp3-check')).toHaveCount(0)
  // On the picture's top-left corner.
  const [thumbnail, mark] = await Promise.all([
    cards.nth(0).locator('yt-thumbnail-view-model').boundingBox(),
    cards.nth(0).locator('selfmp3-check').boundingBox(),
  ])
  expect(mark && thumbnail && [mark.x - thumbnail.x, mark.y - thumbnail.y]).toEqual([8, 8])
  await page.close()
})
