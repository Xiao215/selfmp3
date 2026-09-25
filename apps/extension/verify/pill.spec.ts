import { expect, test, type Page } from '@playwright/test'
import { startFakeServer, TOKEN, type FakeServer } from './fakeServer.js'
import { HELLO_URL, IDOL_URL } from './fixtures.js'
import { extensionPage, launchExtension, type LaunchedExtension } from './launch.js'

/**
 * The pill on a YouTube page (B1), against a page of our own served at
 * youtube.com: a content script is injected by the address, whoever answered
 * it, so this is the real content script in a real page — without asking
 * YouTube for anything, which would make the spec depend on their markup of
 * the day.
 *
 * The pill's shadow root is closed, so what it says is read from `data-state`
 * on the element itself, which is the only thing it puts outside.
 */

test.describe.configure({ mode: 'serial' })

let server: FakeServer
let extension: LaunchedExtension

/** The watch page's shape, as Phase 0 found it, with enough CSS to have a size. */
const WATCH_PAGE = `<!doctype html>
<html><head><style>
  body { margin: 0; font-family: system-ui }
  #top-level-buttons-computed { display: flex; width: 420px; height: 40px; background: #222 }
</style></head>
<body>
  <ytd-watch-flexy>
    <ytd-watch-metadata>
      <div id="above-the-fold">
        <div id="top-row">
          <div id="owner" style="display:block;width:200px;height:40px"></div>
          <div id="actions"><div id="actions-inner"><div id="menu">
            <div id="top-level-buttons-computed"></div>
          </div></div></div>
        </div>
      </div>
    </ytd-watch-metadata>
  </ytd-watch-flexy>
</body></html>`

test.beforeAll(async () => {
  server = await startFakeServer()
  extension = await launchExtension()
  // Every YouTube watch page in this spec is ours.
  await extension.context.route('https://www.youtube.com/watch*', route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: WATCH_PAGE }),
  )
})

test.afterAll(async () => {
  await extension?.close()
  await server?.close()
})

async function watch(url: string): Promise<Page> {
  const page = await extension.context.newPage()
  await page.goto(url)
  return page
}

test('connect the extension first', async () => {
  const page = await extension.context.newPage()
  await page.goto(extensionPage('options.html'))
  await page.getByLabel('Address').fill(server.url)
  // The address alone first: this fake server has a token, so it refuses once
  // and the field to answer with appears (popup.spec.ts covers that properly).
  await page.getByRole('button', { name: 'Use this address' }).click()
  await page.getByLabel('Token').fill(TOKEN)
  await page.getByRole('button', { name: 'Use this address' }).click()
  await expect(page.getByText(`Pointed at ${server.url}`)).toBeVisible()
  await page.close()
})

test('the pill appears on a watch page, and imports the song it is on', async () => {
  const page = await watch(IDOL_URL)
  const pill = page.locator('selfmp3-pill')
  await expect(pill).toHaveAttribute('data-state', 'idle')
  // Where Phase 0 said it goes: inside the button row, first.
  expect(await pill.evaluate(element => element.parentElement?.id)).toBe(
    'top-level-buttons-computed',
  )

  await pill.click()
  // In the queue first; a quick download may be through before the pill looks again.
  await expect(pill).toHaveAttribute('data-state', /^(queued|importing)$/, { timeout: 15_000 })
  await expect(pill).toHaveAttribute('data-state', 'added', { timeout: 30_000 })

  const write = server.requests.find(request => request.path === '/api/import/enqueue')
  expect(write?.method).toBe('POST')
  expect(server.enqueued.at(-1)).toMatchObject({ tagIds: [], playlistId: null })
  await page.close()
})

test('a song already in the library says so instead of offering to import it', async () => {
  const page = await watch(HELLO_URL)
  await expect(page.locator('selfmp3-pill')).toHaveAttribute('data-state', 'have')
  await page.close()
})

test('YouTube redrawing its button row puts the pill back, once', async () => {
  // A video nothing has been done to: the song imported above now has a job,
  // and the one in the library says so, so neither would be resting at "idle".
  const page = await watch('https://www.youtube.com/watch?v=redrawvide0')
  await expect(page.locator('selfmp3-pill')).toHaveAttribute('data-state', 'idle')
  // What YouTube does about a second after each navigation.
  await page.evaluate(() => {
    const row = document.getElementById('top-level-buttons-computed')
    if (row) row.innerHTML = ''
  })
  await expect(page.locator('selfmp3-pill')).toHaveCount(1, { timeout: 10_000 })
  await page.close()
})

test('there is no pill on a page that is not a watch page', async () => {
  await extension.context.route('https://www.youtube.com/feed/**', route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><body></body>' }),
  )
  const page = await extension.context.newPage()
  await page.goto('https://www.youtube.com/feed/subscriptions')
  await page.waitForTimeout(1_000)
  await expect(page.locator('selfmp3-pill')).toHaveCount(0)
  await page.close()
})
