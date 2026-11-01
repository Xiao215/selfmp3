import { expect, test } from '@playwright/test'
import { IDOL_URL } from './fixtures.js'
import { extensionPage, launchExtension, type LaunchedExtension } from './launch.js'

/**
 * An address typed into the options page that has stopped answering, and no
 * account: the popup leads with signing in, which is what finds the server,
 * rather than saying the server is down (docs/features/browser-extension.md,
 * "The popup, state by state").
 */

/** Nothing listens here: the address someone typed in once, for a server since moved. */
const GONE = 'http://127.0.0.1:9'

let extension: LaunchedExtension

test.beforeAll(async () => {
  extension = await launchExtension()
})

test.afterAll(async () => {
  await extension?.close()
})

test('a typed-in address that does not answer asks to sign in, and names the address', async () => {
  // Written as the options page keeps it (store.ts). Installing asked the
  // worker once already, and it holds that answer for a minute (ROUTE_MEMO_MS),
  // so the worker's clock is moved past it: the popup's is a fresh probe.
  const worker =
    extension.context.serviceWorkers()[0] ?? (await extension.context.waitForEvent('serviceworker'))
  await worker.evaluate(
    baseUrl =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('selfmp3-extension', 1)
        open.onupgradeneeded = () => open.result.createObjectStore('kv')
        open.onsuccess = () => {
          const tx = open.result.transaction('kv', 'readwrite')
          tx.objectStore('kv').put({ baseUrl, token: null }, 'server')
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error ?? new Error('IndexedDB failed'))
        }
        open.onerror = () => reject(open.error ?? new Error('could not open IndexedDB'))
      }),
    GONE,
  )
  await worker.evaluate(() => {
    const now = Date.now.bind(Date)
    Date.now = () => now() + 61_000
  })

  const page = await extension.context.newPage()
  await page.goto(extensionPage(`popup.html?${new URLSearchParams({ url: IDOL_URL }).toString()}`))
  await expect(page.getByRole('heading', { name: 'Sign in to find your server' })).toBeVisible()
  await expect(page.getByText('Not signed in')).toBeVisible()
  await expect(
    page.getByText('127.0.0.1:9, the address in the options, didn’t answer.'),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  await expect(page.getByText('Your server isn’t answering')).toBeHidden()
  await page.close()
})
