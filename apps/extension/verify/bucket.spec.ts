import { expect, test, type Page, type Worker } from '@playwright/test'
import { DEFAULT_DOORMAN_URL } from '@selfmp3/shared'
import { IDOL_URL, IDOL_TAB_TITLE } from './fixtures.js'
import { extensionPage, launchExtension, type LaunchedExtension } from './launch.js'

/**
 * Importing with the server asleep (Phase 5, I3).
 *
 * No server is connected here and none is running: the extension is signed in
 * to the bucket, nothing answers, and the link is left for the server to take
 * when it next wakes (SYNC.md, rule 6). What that costs is the *looking* — no
 * preview, no title to correct, no track list — and the popup says so rather
 * than pretending otherwise.
 *
 * The doorman is not called: every request to it is refused at the network, so
 * this device answers from the copy of the library it already has, which is
 * the state any device is in on a plane. Signing in for real needs Google and
 * is on the by-hand list.
 */

test.describe.configure({ mode: 'serial' })

let extension: LaunchedExtension

const SESSION = {
  doormanUrl: DEFAULT_DOORMAN_URL,
  token: 'not-a-real-session',
  me: { email: 'you@example.com', name: 'You', picture: null, storage: null },
}

async function serviceWorker(): Promise<Worker> {
  return (
    extension.context.serviceWorkers()[0] ?? (await extension.context.waitForEvent('serviceworker'))
  )
}

async function popup(url: string, title?: string): Promise<Page> {
  const page = await extension.context.newPage()
  const query = new URLSearchParams({ url, ...(title ? { title } : {}) })
  await page.goto(extensionPage(`popup.html?${query.toString()}`))
  return page
}

test.beforeAll(async () => {
  extension = await launchExtension()
  // Nothing leaves for the real doorman. A device whose bucket cannot be read
  // answers from its own copy, which is exactly the case under test.
  await extension.context.route(`${DEFAULT_DOORMAN_URL}/**`, route => route.abort())

  const worker = await serviceWorker()
  await worker.evaluate(async (session: unknown) => {
    // The state a device is in after signing in and syncing once: a session,
    // and a copy of the library — empty here — so nothing has to be fetched.
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('selfmp3-extension', 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('kv')) request.result.createObjectStore('kv')
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
    })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite')
      tx.objectStore('kv').put(session, 'cloud-session')
      tx.objectStore('kv').put({ key: null, snapshot: null }, 'cloud-base')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
    })
  }, SESSION)

  // The worker keeps its answer about which way in wins for a minute; this is
  // the message that lets go of it, and it also proves no address is typed in.
  const page = await extension.context.newPage()
  await page.goto(extensionPage('options.html'))
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'disconnect' }))
  await page.close()
})

test.afterAll(async () => {
  await extension?.close()
})

test('the options page says which account it is signed in to, and that the server is away', async () => {
  const page = await extension.context.newPage()
  await page.goto(extensionPage('options.html'))
  await expect(page.getByText('you@example.com')).toBeVisible()
  await expect(page.getByText(/links wait in your bucket/)).toBeVisible()
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
