import { chromium, type BrowserContext } from '@playwright/test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EXTENSION_ID } from '@selfmp3/shared'

export const extensionDist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')

export interface LaunchedExtension {
  readonly context: BrowserContext
  close(): Promise<void>
}

/**
 * Chromium with the built extension loaded, in a profile of its own.
 *
 * Playwright's Chromium rather than Google Chrome: Chrome stopped honouring
 * `--load-extension` (docs/features/browser-extension.md, "What the spike settled"). The
 * extension's committed key gives it the same id here as in anyone's Chrome.
 */
export async function launchExtension(): Promise<LaunchedExtension> {
  if (!existsSync(join(extensionDist, 'manifest.json'))) {
    throw new Error('No built extension at apps/extension/dist. Run: npm run build:extension')
  }
  const profile = mkdtempSync(join(tmpdir(), 'selfmp3-extension-'))
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionDist}`, `--load-extension=${extensionDist}`],
  })
  if (context.serviceWorkers().length === 0) await context.waitForEvent('serviceworker')
  return {
    context,
    close: async () => {
      await context.close()
      rmSync(profile, { recursive: true, force: true })
    },
  }
}

/** A page of the extension, by its path. */
export function extensionPage(path: string): string {
  return `chrome-extension://${EXTENSION_ID}/${path}`
}
