import { chromium, type BrowserContext } from '@playwright/test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CLOUD_FORMAT,
  DEFAULT_DOORMAN_URL,
  EXTENSION_ID,
  type CloudServer,
  type CloudSnapshot,
} from '@selfmp3/shared'

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

/** The account the bucket specs are signed in as. */
export const SIGNED_IN_AS = 'you@example.com'

/**
 * Signed in, with a copy of the library already synced once — empty, and
 * naming `server` as the library's server, or no server at all when it is
 * null — and no way to the doorman.
 *
 * Every request to the doorman is refused at the network, so the worker
 * answers from this copy, which is the state any device is in on a plane.
 * Signing in for real needs Google and is on the by-hand list.
 */
export async function signInFromCopy(
  extension: LaunchedExtension,
  server: CloudServer | null,
): Promise<void> {
  await extension.context.route(`${DEFAULT_DOORMAN_URL}/**`, route => route.abort())

  const session = {
    doormanUrl: DEFAULT_DOORMAN_URL,
    token: 'not-a-real-session',
    me: { email: SIGNED_IN_AS, name: 'You', picture: null, storage: null },
  }
  const snapshot: CloudSnapshot | null = server && {
    format: CLOUD_FORMAT,
    writtenAt: new Date().toISOString(),
    writtenBy: 'the-server',
    upTo: {},
    songs: [],
    tags: [],
    playlists: [],
    artists: [],
    artistNames: [],
    spellings: {},
    coverPacks: [],
    sound: null,
    server,
  }

  const worker =
    extension.context.serviceWorkers()[0] ?? (await extension.context.waitForEvent('serviceworker'))
  await worker.evaluate(
    async ([session, snapshot]) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('selfmp3-extension', 1)
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains('kv')) {
            request.result.createObjectStore('kv')
          }
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
      })
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite')
        tx.objectStore('kv').put(session, 'cloud-session')
        tx.objectStore('kv').put({ key: snapshot ? 'snapshot' : null, snapshot }, 'cloud-base')
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
      })
    },
    [session, snapshot] as const,
  )

  // The worker keeps its answer about which way in wins for a minute; this is
  // the message that lets go of it, and it also proves no address is typed in.
  const page = await extension.context.newPage()
  await page.goto(extensionPage('options.html'))
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'disconnect' }))
  await page.close()
}
