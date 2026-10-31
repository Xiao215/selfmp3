import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { build } from 'esbuild'

/**
 * The phone's YouTube page (src/webview/page.ts), as the phone's WebView runs
 * it: its document at `https://www.youtube.com/`, no extension, nothing
 * forwarded. Playwright serves the page at that address and lets every other
 * request go to YouTube for real — which is what the WebView's own address
 * does (`baseUrl`), so what passes here is what the phone would get, short of
 * the phone's own browser engine.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const videos = (process.env['YT_VIDEOS'] ?? 'fJ9rUzIMcZQ').split(',').filter(Boolean)
const PAGE = 'https://www.youtube.com/selfmp3-webview'

interface Got {
  readonly kind: string
  readonly id?: number
  readonly data?: string
  readonly size?: number
  readonly sha256?: string
  readonly message?: string
  readonly facts?: { durationSeconds: number; title: string }
  readonly meta?: { durationSeconds: number }
}

test.beforeAll(() => undefined)

for (const video of videos) {
  test(`describes and downloads ${video} at YouTube's own address`, async ({ page }) => {
    const bundle = await build({
      entryPoints: [join(root, 'src', 'webview', 'page.ts')],
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'iife',
      target: 'es2022',
      conditions: ['source'],
      logLevel: 'warning',
    })
    const script = bundle.outputFiles[0].text
    // The bridge a WebView gives its page, standing in: what the page says is kept to be read.
    const bridge = `window.__got = []; window.ReactNativeWebView = { postMessage: m => window.__got.push(JSON.parse(m)) };`
    await page.route(PAGE, route =>
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: `<!doctype html><meta charset="utf-8"><script>${bridge}</script><script>${script.replaceAll('</script', '<\\/script')}</script>`,
      }),
    )
    page.on('console', message => console.warn(`[page] ${message.text()}`))
    await page.goto(PAGE)

    const got = (): Promise<Got[]> =>
      page.evaluate(() => (window as unknown as { __got: Got[] }).__got)
    await expect.poll(async () => (await got()).some(m => m.kind === 'ready')).toBe(true)

    const url = `https://www.youtube.com/watch?v=${video}`
    await page.evaluate(
      u =>
        (window as unknown as { __selfmp3Receive: (m: unknown) => void }).__selfmp3Receive({
          kind: 'describe',
          id: 1,
          url: u,
        }),
      url,
    )
    await expect
      .poll(async () => (await got()).find(m => m.id === 1 && m.kind !== 'progress')?.kind, {
        timeout: 120_000,
      })
      .toBe('described')
    const described = (await got()).find(m => m.kind === 'described')!
    console.warn(`${video}: ${described.facts?.title}, ${described.facts?.durationSeconds}s`)

    await page.evaluate(
      u =>
        (window as unknown as { __selfmp3Receive: (m: unknown) => void }).__selfmp3Receive({
          kind: 'download',
          id: 2,
          url: u,
        }),
      url,
    )
    await expect
      .poll(
        async () => {
          const last = (await got()).filter(
            m => m.id === 2 && m.kind !== 'progress' && m.kind !== 'chunk',
          )
          return last.at(-1)?.kind ?? null
        },
        { timeout: 4 * 60_000, intervals: [1000] },
      )
      .toBe('downloaded')
    const messages = (await got()).filter(m => m.id === 2)
    const failed = messages.find(m => m.kind === 'failed')
    expect(failed?.message ?? null).toBeNull()

    const bytes = Buffer.concat(
      messages.filter(m => m.kind === 'chunk').map(m => Buffer.from(m.data ?? '', 'base64')),
    )
    const done = messages.find(m => m.kind === 'downloaded')!
    expect(bytes.length).toBe(done.size)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(done.sha256)
    console.warn(`${video}: ${bytes.length} bytes, ${done.meta?.durationSeconds}s`)
  })
}
