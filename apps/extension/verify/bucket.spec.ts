import { expect, test, type Page } from '@playwright/test'
import { DEFAULT_DOORMAN_URL, type CloudServer } from '@selfmp3/shared'
import { IDOL_URL, IDOL_TAB_TITLE } from './fixtures.js'
import {
  extensionPage,
  launchExtension,
  signInFromCopy,
  SIGNED_IN_AS,
  type LaunchedExtension,
} from './launch.js'

/**
 * Importing with the server asleep (Phase 5, I3).
 *
 * No server is connected here and none is running: the extension is signed in
 * to the bucket, nothing answers, and the link is left for the server to take
 * when it next wakes (SYNC.md, rule 6). What that costs is the *looking* — no
 * preview, no title to correct, no track list — and the popup says so rather
 * than pretending otherwise.
 *
 * The doorman is not called (`signInFromCopy`): this device answers from the
 * copy of the library it already has, whose snapshot names a server that does
 * not answer. A bucket that names no server at all is noServer.spec.ts.
 */

test.describe.configure({ mode: 'serial' })

let extension: LaunchedExtension

/**
 * The library's server, as the last snapshot names it: an address where
 * nothing listens, so it is asleep.
 */
const ASLEEP: CloudServer = {
  id: 'the-server',
  addresses: ['http://127.0.0.1:4699'],
  token: 'from-the-snapshot',
}

async function popup(url: string, title?: string): Promise<Page> {
  const page = await extension.context.newPage()
  const query = new URLSearchParams({ url, ...(title ? { title } : {}) })
  await page.goto(extensionPage(`popup.html?${query.toString()}`))
  return page
}

test.beforeAll(async () => {
  extension = await launchExtension()
  await signInFromCopy(extension, ASLEEP)
})

test.afterAll(async () => {
  await extension?.close()
})

test('the options page says which account it is signed in to, and that the server is away', async () => {
  const page = await extension.context.newPage()
  await page.goto(extensionPage('options.html'))
  await expect(page.getByText(SIGNED_IN_AS)).toBeVisible()
  await expect(
    page.getByText(/Your server isn’t answering, so links wait in your bucket/),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeHidden()
  await page.close()
})

test('a song page offers the link itself, since only the server could read it', async () => {
  const page = await popup(IDOL_URL, IDOL_TAB_TITLE)
  await expect(page.getByText('Via your bucket')).toBeVisible()
  await expect(
    page.getByText('Your server will read the details when it fetches this.'),
  ).toBeVisible()
  // Nothing was read, so there is nothing to correct.
  await expect(page.getByLabel('Title')).toBeHidden()

  await page.getByRole('button', { name: 'Keep it for later' }).click()
  await expect(page.getByText(/^Waiting for your server/)).toBeVisible()
  await expect(page.getByText('1 link waiting for your server')).toBeVisible()
  await page.close()
})

test('the link is still waiting when the popup is opened again, and can be called off', async () => {
  const page = await popup(IDOL_URL, IDOL_TAB_TITLE)
  await expect(page.getByText(/^Waiting for your server/)).toBeVisible()
  await page.getByRole('button', { name: 'Don’t bother' }).click()
  await expect(page.getByRole('button', { name: 'Keep it for later' })).toBeVisible()
  await expect(page.getByText('Nothing waiting')).toBeVisible()
  await page.close()
})

/**
 * The sign-in itself, as far as it can be driven without Google: the worker
 * writes the attempt down and hands back where to go, and Chrome's own window
 * is what opens it. A closed window is not a failure and does not read as one.
 */
test('signing in asks Chrome for the doorman, with an address it can come back to', async () => {
  const page = await extension.context.newPage()
  await page.addInitScript(() => {
    const asked: string[] = []
    ;(globalThis as unknown as { __asked: string[] }).__asked = asked
    chrome.identity.launchWebAuthFlow = (details: { url: string }) => {
      asked.push(details.url)
      return Promise.reject(new Error('The user did not approve access.'))
    }
  })
  await page.goto(extensionPage('options.html'))
  // Signed in already, so sign out first to get the button back.
  await page.getByRole('button', { name: 'Sign out' }).click()
  await page.getByRole('button', { name: 'Sign in with Google' }).click()

  await expect(page.getByRole('alert')).toHaveText(
    'That sign-in window was closed before Google finished.',
  )
  const asked = await page.evaluate(() => (globalThis as unknown as { __asked: string[] }).__asked)
  expect(asked).toHaveLength(1)
  const url = new URL(asked[0] ?? '')
  expect(url.origin + url.pathname).toBe(`${DEFAULT_DOORMAN_URL}/v1/auth/start`)
  expect(url.searchParams.get('attempt')).toMatch(/^[0-9a-f]{32}$/)
  // Google will not redirect to a chrome-extension:// address; Chrome
  // intercepts this one instead, and nothing is ever fetched from it.
  expect(url.searchParams.get('return')).toBe(
    'https://ojgfoohmmkangonahnbdpelfgmkjkfpi.chromiumapp.org/',
  )
  await page.close()
})
