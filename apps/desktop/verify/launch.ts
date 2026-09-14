import { mkdtempSync } from 'node:fs'
import { createRequire } from 'node:module'
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

/**
 * Chromium refuses its own sandbox when the process is root, which a container
 * often is and a Mac never is. This is a fact about where the test ran and
 * never something the shipped app asks for.
 */
const rootFlags = process.getuid?.() === 0 ? ['--no-sandbox'] : []

/**
 * The Electron binary to launch, and the app to launch with it.
 *
 * `node_modules/electron/dist/electron` is the *Linux* binary name — on a Mac
 * the package puts it at `dist/Electron.app/Contents/MacOS/Electron` — so the
 * path is asked of the electron package, which writes the per-platform relative
 * path into `path.txt` at install time and whose main export is the resolved
 * string. Spelling it out here is what made `verify:desktop` die with ENOENT
 * before a single test ran on macOS.
 *
 * Both halves are overridable, because "the app under test is the unpackaged
 * `dist/main.cjs`" is a default rather than a fact about the suite: pointing
 * `SELFMP3_DESKTOP_EXECUTABLE` at an installed `self.mp3.app/Contents/MacOS/
 * self.mp3` and clearing `SELFMP3_DESKTOP_APP_PATH` runs these same tests
 * against a packaged build, where `app.isPackaged` is true and the web root and
 * the preload are read from inside `app.asar`.
 */
// `electron`'s main export is the path string, but its types describe the
// module an Electron process gets, so the cast says which of the two this is.
const defaultExecutable = createRequire(__filename)('electron') as unknown as string

export function executable(): string {
  return process.env['SELFMP3_DESKTOP_EXECUTABLE'] ?? defaultExecutable
}

/**
 * The argument that names the app, or nothing when the executable *is* the app.
 *
 * An empty `SELFMP3_DESKTOP_APP_PATH` means "the executable carries its own
 * app", which is what a packaged build is.
 */
function appArgs(): string[] {
  const configured = process.env['SELFMP3_DESKTOP_APP_PATH']
  if (configured === undefined) return [join(desktopRoot, 'dist', 'main.cjs')]
  return configured === '' ? [] : [configured]
}

/**
 * Launch the built shell with a `userData` of its own.
 *
 * A fresh one per run, because a signed-in session, a window size and a
 * download index all live there, and a test that inherits the last run's is a
 * test that passes for the wrong reason.
 */
export async function launchApp({
  env = {},
  userDataDir,
}: {
  env?: Record<string, string>
  /** Pass the same directory twice to test what a relaunch remembers. */
  userDataDir?: string
} = {}): Promise<ElectronApplication> {
  return electron.launch({
    executablePath: executable(),
    args: [...rootFlags, ...appArgs(), `--user-data-dir=${userDataDir ?? freshUserData()}`],
    env: { ...process.env, ...env } as Record<string, string>,
  })
}

/** A `userData` nothing else has used. */
export function freshUserData(): string {
  return mkdtempSync(join(tmpdir(), 'selfmp3-smoke-'))
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
