/**
 * The harness in a Chromium nothing is driving: no Playwright, no DevTools
 * protocol — the browser as a person would have it, with the extension loaded.
 * BotGuard can tell a page under automation, and a PO token minted under
 * Playwright may be worth nothing for that reason alone.
 *
 * Needs the harness running (`npm run harness --workspace @selfmp3/ytclient`)
 * and the extension built. Prints the report the page posts back.
 *
 *   node packages/ytclient/verify/plainBrowser.mjs [video] [clients] [chunkBytes]
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from '@playwright/test'

const here = dirname(fileURLToPath(import.meta.url))
const extension = join(here, '..', '..', '..', 'apps', 'extension', 'dist')
const [video = 'fJ9rUzIMcZQ', clients = '', chunk = ''] = process.argv.slice(2)
const query = new URLSearchParams({
  auto: '1',
  video,
  clients,
  chunk,
  po: process.env.YT_PO ?? '1',
})

const profile = mkdtempSync(join(tmpdir(), 'selfmp3-plain-'))
const browser = spawn(
  chromium.executablePath(),
  [
    `--user-data-dir=${profile}`,
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
    '--no-first-run',
    '--no-default-browser-check',
    `http://localhost:4602/?${query}`,
  ],
  { stdio: 'ignore' },
)

let report = null
for (let i = 0; i < 180 && report === null; i++) {
  await sleep(1000)
  const response = await fetch('http://localhost:4602/report').catch(() => null)
  if (response?.ok) report = await response.json()
}
browser.kill()
await sleep(1000)
rmSync(profile, { recursive: true, force: true })

if (report === null) {
  console.error('No report in three minutes.')
  process.exit(1)
}
console.log(report.log)
process.exit(report.ok ? 0 : 1)
