import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, type ElectronApplication } from '@playwright/test'

/*
 * `__dirname`, not `import.meta.url`: `apps/desktop/package.json` has no
 * `"type": "module"` — the shell is bundled to CommonJS — so Playwright
 * transpiles these specs to CommonJS too, and `import.meta` is a syntax error
 * there.
 */
export const desktopRoot = join(__dirname, '..')
export const repoRoot = join(desktopRoot, '..', '..')

/**
 * Chromium refuses its own sandbox when the process is root, which a container
 * often is and a Mac never is. This is a fact about where the test ran and
 * never something the shipped app asks for.
 */
const rootFlags = process.getuid?.() === 0 ? ['--no-sandbox'] : []

/**
 * Launch the built shell with a `userData` of its own.
 *
 * A fresh one per run, because a signed-in session, a window size and a
 * download index all live there, and a test that inherits the last run's is a
 * test that passes for the wrong reason.
 */
export async function launchApp(
  { env = {} }: { env?: Record<string, string> } = {},
): Promise<ElectronApplication> {
  return electron.launch({
    executablePath: join(repoRoot, 'node_modules', 'electron', 'dist', 'electron'),
    args: [...rootFlags, join(desktopRoot, 'dist', 'main.cjs'), `--user-data-dir=${mkdtempSync(join(tmpdir(), 'selfmp3-smoke-'))}`],
    env: { ...process.env, ...env } as Record<string, string>,
  })
}

/** The dev server the "connects and plays" flow needs, when there is one. */
export const appApi = process.env['SELFMP3_APP_API'] ?? null

export async function serverHasSongs(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(3000) })
    return response.ok
  } catch {
    return false
  }
}
