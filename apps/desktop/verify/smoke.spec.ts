import { expect, test } from '@playwright/test'

import { appApi, launchApp, serverHasSongs } from './launch'

/**
 * The desktop smoke.
 *
 * Two kinds of test here, and the difference matters when you read a run:
 * everything about the *shell* — the window, the origin, what the page can and
 * cannot reach — needs nothing but the built app, and runs anywhere. The flow
 * that plays a song needs a server with the thirteen-song dev library on it,
 * which is a Mac; it says so and skips rather than pretending.
 */

test.describe('the shell', () => {
  test('opens the export at its own origin, with nothing of Node on the page', async () => {
    const app = await launchApp()
    try {
      const page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')

      expect(page.url()).toBe('app://selfmp3/')

      const world = await page.evaluate(() => ({
        bridge: typeof (window as { selfmp3Desktop?: unknown }).selfmp3Desktop,
        require: typeof (window as { require?: unknown }).require,
        ipcRenderer: typeof (window as { ipcRenderer?: unknown }).ipcRenderer,
        // Not `typeof process`: Metro's web bundle defines a `process` shim of
        // its own for `process.env.NODE_ENV`, so the question is whether it is
        // *Node's*, which is what `versions.electron` would mean.
        nodeProcess: (window as { process?: { versions?: { electron?: string } } }).process?.versions
          ?.electron,
        secureContext: window.isSecureContext,
      }))

      // The bridge is the only door: no require, no ipcRenderer, no process.
      expect(world.bridge).toBe('object')
      expect(world.require).toBe('undefined')
      expect(world.ipcRenderer).toBe('undefined')
      expect(world.nodeProcess).toBeUndefined()
      expect(world.secureContext).toBe(true)
    } finally {
      await app.close()
    }
  })

  test('tells the page what it is, and where it keeps things', async () => {
    const app = await launchApp()
    try {
      const page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')

      const info = await page.evaluate(
        () => (window as unknown as { selfmp3Desktop: { info: Record<string, unknown> } }).selfmp3Desktop.info,
      )

      expect(info['platform']).toBe(process.platform)
      expect(String(info['version'])).toMatch(/^\d+\.\d+\.\d+$/)
      expect(String(info['hostname']).length).toBeGreaterThan(0)
      expect(String(info['songsDir'])).toContain(String(info['userData']))
      expect(info['development']).toBe(false)
    } finally {
      await app.close()
    }
  })

  test('draws something, which means the export ran', async () => {
    const app = await launchApp()
    try {
      const page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      // The bundle mounts a moment after load; the app's own name is the first
      // thing on the sign-in screen.
      await expect(page.locator('body')).toContainText(/self\.mp3/i, { timeout: 30_000 })
    } finally {
      await app.close()
    }
  })

  test('is an installed app, so it downloads rather than streams', async () => {
    const app = await launchApp()
    try {
      const page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      // `install.web.ts` reads exactly this, and everything about downloading
      // hangs off it.
      const installed = await page.evaluate(() =>
        Boolean((window as { selfmp3Desktop?: unknown }).selfmp3Desktop),
      )
      expect(installed).toBe(true)
    } finally {
      await app.close()
    }
  })

  test('holds the single-instance lock and claims nothing it should not', async () => {
    const app = await launchApp()
    try {
      // Read from the main process rather than inferred from the page.
      const seen = await app.evaluate(({ app: electronApp }) => ({
        name: electronApp.name,
        version: electronApp.getVersion(),
        // A second launch would be handed here rather than opening a window.
        hasLock: electronApp.hasSingleInstanceLock(),
      }))
      expect(seen.hasLock).toBe(true)
      expect(seen.version).toMatch(/^\d+\.\d+\.\d+$/)
    } finally {
      await app.close()
    }
  })

  test('keeps a secret through the bridge and gives it back', async () => {
    const app = await launchApp()
    try {
      const page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      const round = await page.evaluate(async () => {
        const desktop = (window as unknown as {
          selfmp3Desktop: { secrets: { get(k: string): Promise<string | null>; set(k: string, v: string): Promise<void>; remove(k: string): Promise<void> } }
        }).selfmp3Desktop
        await desktop.secrets.set('smoke.token', 'a-token')
        const read = await desktop.secrets.get('smoke.token')
        await desktop.secrets.remove('smoke.token')
        const gone = await desktop.secrets.get('smoke.token')
        return { read, gone }
      })
      expect(round.read).toBe('a-token')
      expect(round.gone).toBeNull()
    } finally {
      await app.close()
    }
  })

  test('refuses a secret key that is really a path', async () => {
    const app = await launchApp()
    try {
      const page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      const refused = await page.evaluate(async () => {
        const desktop = (window as unknown as {
          selfmp3Desktop: { secrets: { set(k: string, v: string): Promise<void> } }
        }).selfmp3Desktop
        try {
          await desktop.secrets.set('../../etc/passwd', 'no')
          return false
        } catch {
          return true
        }
      })
      expect(refused).toBe(true)
    } finally {
      await app.close()
    }
  })
})

test.describe('connects and plays', () => {
  test('a row plays from a server, and the bar shows it', async () => {
    test.skip(
      appApi === null,
      'needs a dev server with the thirteen-song library: set SELFMP3_APP_API=http://localhost:4600',
    )
    const reachable = appApi !== null && (await serverHasSongs(appApi))
    test.skip(!reachable, `no server answering at ${String(appApi)}`)

    const app = await launchApp({ env: { SELFMP3_APP_API: String(appApi) } })
    try {
      const page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      await expect(page.getByTestId('song-row').first()).toBeVisible({ timeout: 30_000 })
      await page.getByTestId('song-row').first().dblclick()
      await expect(page.getByTestId('player-bar')).toBeVisible()
    } finally {
      await app.close()
    }
  })
})
