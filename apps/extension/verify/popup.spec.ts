import { expect, test, type Page, type Worker } from '@playwright/test'
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

/** The extension's background worker, however Chrome has it at this moment. */
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

test('before a server is connected, the popup asks for one', async () => {
  const page = await popup(IDOL_URL)
  await expect(page.getByRole('heading', { name: 'Connect to your library' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Set it up' })).toBeVisible()
  await page.close()
})

/**
 * The address is all that is asked for until the server refuses without a
 * token. Almost no server has one, so the field is not put in front of someone
 * who will never need it — it arrives when the server has said it does.
 */
test('the options page asks for a token only once the server wants one', async () => {
  const page = await extension.context.newPage()
  await page.goto(extensionPage('options.html'))
  await expect(page.getByLabel('Token')).toBeHidden()

  await page.getByLabel('Address').fill(server.url)
  await page.getByRole('button', { name: 'Use this address' }).click()
  await expect(page.getByRole('alert')).toHaveText('That server needs its token.')
  await expect(page.getByLabel('Token')).toBeVisible()

  await page.getByLabel('Token').fill('wrong')
  await page.getByRole('button', { name: 'Use this address' }).click()
  await expect(page.getByRole('alert')).toHaveText('The server refused that token.')

  await page.getByLabel('Token').fill(TOKEN)
  await page.getByRole('button', { name: 'Use this address' }).click()
  await expect(page.getByText(`Pointed at ${server.url} · 2 songs`)).toBeVisible()
  await page.close()
})

test('a song page imports, and the popup follows the job until it is added', async () => {
  const page = await popup(IDOL_URL, IDOL_TAB_TITLE)
  await expect(page.getByLabel('Title')).toHaveValue('アイドル')
  await expect(page.getByLabel('Artist')).toHaveValue('YOASOBI')
  await expect(page.getByText(/^Tidied from/)).toBeVisible()
  // The title is corrected before it is saved, not after.
  await page.getByLabel('Artist').fill('YOASOBI (Ayase)')

  // The tag every import gets is on and stays on; the others are yours to pick.
  const defaultTag = page.getByRole('button', { name: 'new', exact: true })
  await expect(defaultTag).toBeDisabled()
  await expect(defaultTag).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'j-pop', exact: true }).click()

  // A tag that is not there yet is made from here, and picked once it exists.
  await page.getByRole('button', { name: '+ new' }).click()
  await page.getByLabel('New tag').fill('city pop')
  await page.getByLabel('New tag').press('Enter')
  await expect(page.getByRole('button', { name: 'city pop', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  // Never a playlist: an import only ever tags.
  await expect(page.getByText(/playlist/i)).toHaveCount(0)
  await expect(page.getByRole('combobox')).toHaveCount(0)

  await page.getByRole('button', { name: 'Import to your library' }).click()
  await expect(page.getByText(/^Downloading/)).toBeVisible()
  await expect(page.getByText('Added to your library')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/^Tagged new, j-pop and city pop\./)).toBeVisible()

  expect(server.enqueued).toEqual([
    expect.objectContaining({
      tagIds: [1, 2, 3],
      playlistId: null,
      createPlaylistName: null,
      items: [
        expect.objectContaining({ url: IDOL_URL, title: 'アイドル', artist: 'YOASOBI (Ayase)' }),
      ],
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

test('a playlist comes in whole unless a song is left out, and the badge and a notice follow it', async () => {
  const worker = await serviceWorker()
  await worker.evaluate(() => {
    // Keep what the worker announces, so the spec can read it back.
    const scope = globalThis as unknown as { __notices: unknown[] }
    scope.__notices = []
    const create = chrome.notifications.create.bind(chrome.notifications)
    chrome.notifications.create = ((...args: unknown[]) => {
      scope.__notices.push(args)
      return create(...(args as Parameters<typeof create>))
    }) as typeof chrome.notifications.create
  })

  const page = await popup(PLAYLIST_URL)
  await expect(page.getByText('City pop night drive')).toBeVisible()
  // Every song is coming in but the one already yours; there is nothing to tick.
  await expect(page.getByText('2 of 3 coming in')).toBeVisible()
  await expect(page.getByText('Yours already')).toBeVisible()
  await expect(page.getByRole('checkbox')).toHaveCount(0)

  // The far end of a row leaves the song out, and brings it back.
  await page.getByRole('button', { name: 'Leave out Mayonaka no Door' }).click()
  await expect(page.getByText('Left out')).toBeVisible()
  await expect(page.getByText('1 of 3 coming in')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Import 1 song' })).toBeVisible()
  await page.getByRole('button', { name: 'Bring back Mayonaka no Door' }).click()
  await expect(page.getByText('Left out')).toHaveCount(0)

  // A name is a field once it is clicked.
  await page.getByRole('button', { name: /^Plastic Love/ }).click()
  await page.getByLabel('Title').fill('Plastic Love (2021 remaster)')
  await page.getByLabel('Title').press('Enter')
  await expect(page.getByText('Plastic Love (2021 remaster)')).toBeVisible()

  // Never a playlist made of them.
  await expect(page.getByText(/create playlist/i)).toHaveCount(0)

  await page.getByRole('button', { name: 'Import 2 songs' }).click()
  await expect(page.getByText(/^Downloading|Waiting in queue/)).toBeVisible()

  const enqueued = server.enqueued.at(-1)
  expect(enqueued?.items.map(item => item.title)).toEqual([
    'Plastic Love (2021 remaster)',
    'Mayonaka no Door',
  ])
  expect(enqueued?.playlistId).toBeNull()
  expect(enqueued?.createPlaylistName).toBeNull()

  // The toolbar badge counts this extension's imports, then clears.
  await expect
    .poll(() => worker.evaluate(() => chrome.action.getBadgeText({})), { timeout: 15_000 })
    .toBe('2')
  await expect
    .poll(() => worker.evaluate(() => chrome.action.getBadgeText({})), { timeout: 30_000 })
    .toBe('')
  await expect(page.getByText('2 songs added to your library')).toBeVisible()

  const notices = await worker.evaluate(() =>
    JSON.stringify((globalThis as unknown as { __notices: unknown[] }).__notices),
  )
  expect(notices).toContain('2 songs added')
  expect(notices).toContain('City pop night drive')
  await page.close()
})

test('the right-click items are there for any link', async () => {
  const worker = await serviceWorker()
  const menus = await worker.evaluate(
    () =>
      new Promise<{ id: string; title: string; contexts: string[] }[]>(resolve => {
        // The worker keeps no list of its own menus, so ask Chrome to make one
        // it already has: a duplicate id is refused, which says it exists.
        const ids = ['selfmp3-import', 'selfmp3-import-with']
        const found: { id: string; title: string; contexts: string[] }[] = []
        let left = ids.length
        for (const id of ids) {
          chrome.contextMenus.create({ id, title: id, contexts: ['link'] }, () => {
            const error = chrome.runtime.lastError?.message ?? ''
            if (error.includes('duplicate')) found.push({ id, title: id, contexts: ['link'] })
            if (--left === 0) resolve(found)
          })
        }
      }),
  )
  expect(menus.map(menu => menu.id).sort()).toEqual(['selfmp3-import', 'selfmp3-import-with'])
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
