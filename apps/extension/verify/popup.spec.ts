import { expect, test, type Page } from '@playwright/test'
import { EXTENSION_ORIGIN } from '@selfmp3/shared'
import { startFakeServer, TOKEN, type FakeServer } from './fakeServer.js'
import { HELLO_URL, IDOL_TAB_TITLE, IDOL_URL, PLAYLIST_URL, PRIVATE_URL } from './fixtures.js'
import { extensionPage, launchExtension, type LaunchedExtension } from './launch.js'

/**
 * The popup through the server (Phase 2): connecting, a song page imported to
 * the end, and each state the popup can be in for a link.
 *
 * The popup is opened as a tab with `?url=` in place of the tab it would read:
 * Playwright cannot press the toolbar button.
 */

test.describe.configure({ mode: 'serial' })

let server: FakeServer
let extension: LaunchedExtension

test.beforeAll(async () => {
  server = await startFakeServer()
  extension = await launchExtension()
})

test.afterAll(async () => {
  await extension?.close()
  await server?.close()
})

async function popup(url: string, title?: string): Promise<Page> {
  const page = await extension.context.newPage()
  const query = new URLSearchParams({ url, ...(title ? { title } : {}) })
  await page.goto(extensionPage(`popup.html?${query.toString()}`))
  return page
}

test('before a server is connected, the popup asks for one', async () => {
  const page = await popup(IDOL_URL)
  await expect(page.getByRole('heading', { name: 'Connect to your library' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open options' })).toBeVisible()
  await page.close()
})

test('the options page refuses a wrong token, and keeps the right one', async () => {
  const page = await extension.context.newPage()
  await page.goto(extensionPage('options.html'))
  await page.getByLabel('Address').fill(server.url)
  await page.getByLabel('Token').fill('wrong')
  await page.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('The server refused that token.')

  await page.getByLabel('Token').fill(TOKEN)
  await page.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(page.getByText(`Connected to ${server.url} · 2 songs`)).toBeVisible()
  await page.close()
})

test('a song page imports, and the popup follows the job until it is added', async () => {
  const page = await popup(IDOL_URL, IDOL_TAB_TITLE)
  await expect(page.getByLabel('Title')).toHaveValue('アイドル')
  await expect(page.getByLabel('Artist')).toHaveValue('YOASOBI')
  await expect(page.getByText('Cleaned from')).toBeVisible()

  // The tag every import gets is on and stays on; the others are yours to pick.
  const defaultTag = page.getByRole('button', { name: 'new', exact: true })
  await expect(defaultTag).toBeDisabled()
  await expect(defaultTag).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'j-pop', exact: true }).click()

  // A live playlist is not offered: imports cannot go into one.
  const playlist = page.getByLabel('Add to playlist')
  await expect(playlist.locator('option')).toHaveText(['No playlist', 'Gym rotation'])
  await playlist.selectOption({ label: 'Gym rotation' })

  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(page.getByText(/^Downloading/)).toBeVisible()
  await expect(page.getByText('Added to your library')).toBeVisible({ timeout: 20_000 })

  expect(server.enqueued).toEqual([
    expect.objectContaining({
      tagIds: [1, 2],
      playlistId: 1,
      createPlaylistName: null,
      items: [expect.objectContaining({ url: IDOL_URL, title: 'アイドル', artist: 'YOASOBI' })],
    }),
  ])
  // The write came from the extension's own origin, the one the server lets through.
  const write = server.requests.find(request => request.path === '/api/import/enqueue')
  expect(write?.origin).toBe(EXTENSION_ORIGIN)
  await page.close()
})

test('a song already in the library says so, without asking the server to read it', async () => {
  const before = server.requests.filter(request => request.path === '/api/import/preview').length
  const page = await popup(HELLO_URL)
  await expect(page.getByText('In your library since 12 Aug · played 41 times')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Import anyway' })).toBeVisible()
  expect(server.requests.filter(request => request.path === '/api/import/preview')).toHaveLength(
    before,
  )
  await page.close()
})

test('a link the server cannot read shows its reason', async () => {
  const page = await popup(PRIVATE_URL)
  await expect(page.getByRole('alert')).toContainText('This video is private.')
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  await page.close()
})

test('a playlist counts its songs and offers the full review', async () => {
  const page = await popup(PLAYLIST_URL)
  await expect(page.getByText('City pop night drive')).toBeVisible()
  await expect(page.getByText('3 songs · 1 already in your library')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open the full review' })).toBeVisible()
  await page.close()
})

test('a page with nothing to import offers the paste box', async () => {
  const page = await popup('https://example.com/some/article')
  const box = page.getByLabel('Paste a link')
  await expect(box).toBeVisible()
  await box.fill('not a link')
  await expect(page.getByRole('button', { name: 'Look up' })).toBeDisabled()
  await box.fill('Shared with me: https://youtu.be/dGZqpVCJP3k')
  await page.getByRole('button', { name: 'Look up' }).click()
  await expect(page.getByLabel('Title')).toHaveValue('アイドル')
  await page.close()
})
