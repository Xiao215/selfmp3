import { expect, test, type Page } from '@playwright/test'
import { DEFAULT_APP_URL, DEFAULT_SERVER_URL } from '@selfmp3/shared'
import { IDOL_TAB_TITLE, IDOL_URL } from './fixtures.js'
import { extensionPage, launchExtension, signInFromCopy, type LaunchedExtension } from './launch.js'

/**
 * A bucket that names no server at all: nothing has joined one for this
 * account yet (docs/features/browser-extension.md, "Connecting it").
 *
 * The app would join the shared server here by itself. The extension does not
 * — it cannot see whether this computer's app removed the shared server — so
 * the link still waits in the bucket, and the popup says to open self.mp3,
 * whose first open connects one.
 */

test.describe.configure({ mode: 'serial' })

let extension: LaunchedExtension

/** Everything asked of the shared server: nothing, since the extension never joins it. */
const askedShared: string[] = []

async function popup(url: string, title?: string): Promise<Page> {
  const page = await extension.context.newPage()
  const query = new URLSearchParams({ url, ...(title ? { title } : {}) })
  await page.goto(extensionPage(`popup.html?${query.toString()}`))
  return page
}

test.beforeAll(async () => {
  extension = await launchExtension()
  await extension.context.route(`${DEFAULT_SERVER_URL}/**`, route => {
    askedShared.push(route.request().url())
    return route.abort()
  })
  // The app itself is not this test's: a page that answers is enough.
  await extension.context.route(`${DEFAULT_APP_URL}/**`, route =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>self.mp3</title>' }),
  )
  await signInFromCopy(extension, null)
})

test.afterAll(async () => {
  await extension?.close()
})

test('the options page says no computer works for the library yet, and where to connect one', async () => {
  const page = await extension.context.newPage()
  await page.goto(extensionPage('options.html'))
  await expect(page.getByText(/No computer works for your library yet/)).toBeVisible()
  await expect(page.getByText(/Open self\.mp3 to connect one/)).toBeVisible()
  await page.close()
})

test('a song page still keeps the link in the bucket, and offers to open self.mp3', async () => {
  const page = await popup(IDOL_URL, IDOL_TAB_TITLE)
  await expect(page.getByText('Via your bucket')).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'No computer works for your library yet' }),
  ).toBeVisible()

  const opened = extension.context.waitForEvent('page')
  await page.getByRole('button', { name: 'Open self.mp3' }).click()
  const app = await opened
  await app.waitForURL(`${DEFAULT_APP_URL}/`)
  await app.close()

  await page.getByRole('button', { name: 'Keep it for later' }).click()
  await expect(page.getByText(/^Waiting for your server/)).toBeVisible()
  await page.close()

  expect(askedShared).toEqual([])
})
