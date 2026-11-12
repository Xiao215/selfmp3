import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect, test, type BrowserContext } from '@playwright/test'
import type { RunOptions } from '../harness/main.js'

const extensionDist = join(dirname(fileURLToPath(import.meta.url)), '../../../apps/extension/dist')
const videos = (process.env['YT_VIDEOS'] ?? 'fJ9rUzIMcZQ').split(',').filter(Boolean)

let context: BrowserContext
let profile: string

test.beforeAll(async () => {
  if (!existsSync(join(extensionDist, 'manifest.json'))) {
    throw new Error('No built extension at apps/extension/dist. Run: npm run build:extension')
  }
  profile = mkdtempSync(join(tmpdir(), 'selfmp3-ytclient-'))
  // Playwright's Chromium: Chrome no longer loads an extension from the
  // command line (apps/extension/verify/launch.ts).
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: !process.env['HEADED'],
    args: [
      `--disable-extensions-except=${extensionDist}`,
      `--load-extension=${extensionDist}`,
      // `navigator.webdriver` is something BotGuard can read; a person's
      // browser does not say it.
      '--disable-blink-features=AutomationControlled',
    ],
  })
  if (context.serviceWorkers().length === 0) await context.waitForEvent('serviceworker')
})

test.afterAll(async () => {
  await context.close()
  rmSync(profile, { recursive: true, force: true })
})

/** The file's length by ffprobe, or null without one. */
function probeSeconds(file: string): number | null {
  try {
    const out = execFileSync('ffprobe', [
      '-v',
      'quiet',
      '-show_entries',
      'format=duration',
      '-of',
      'csv=p=0',
      file,
    ])
    return Number.parseFloat(out.toString().trim())
  } catch {
    return null
  }
}

for (const video of videos) {
  // eslint-disable-next-line no-empty-pattern -- Playwright hands the test info second.
  test(`downloads ${video} whole, in the page, through the extension`, async ({}, testInfo) => {
    const page = await context.newPage()
    page.on('console', message => console.warn(`[page] ${message.text()}`))
    await page.goto('http://localhost:4602/')
    await page.waitForFunction(() => 'ytHarness' in window)

    const clients = process.env['YT_CLIENTS']?.split(',').filter(Boolean)
    const chunk = Number(process.env['YT_CHUNK'] ?? 0)
    const options: RunOptions = {
      video,
      ...(clients ? { clients } : {}),
      ...(process.env['YT_PO'] === '0' ? { poToken: false } : {}),
      ...(chunk ? { chunkBytes: chunk } : {}),
    }
    const report = await page.evaluate(o => window.ytHarness.run(o), options)
    await testInfo.attach('report.json', {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    })
    expect(report.error).toBeNull()
    expect(report.ok).toBe(true)

    const base64 = await page.evaluate(() => window.ytHarness.lastBytes())
    const bytes = Buffer.from(base64 ?? '', 'base64')
    const result = report.result!
    expect(bytes.length).toBe(result.size)

    const file = testInfo.outputPath(`${video}.m4a`)
    writeFileSync(file, bytes)
    const seconds = probeSeconds(file)
    console.warn(
      `${video}: ${result.client} itag ${result.itag}, ${bytes.length} bytes, ${seconds}s`,
    )
    if (seconds !== null) expect(Math.abs(seconds - result.durationSeconds)).toBeLessThan(2)
  })
}
