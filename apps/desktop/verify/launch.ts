import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
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
export async function launchApp({
  env = {},
  userDataDir,
}: {
  env?: Record<string, string>
  /** Pass the same directory twice to test what a relaunch remembers. */
  userDataDir?: string
} = {}): Promise<ElectronApplication> {
  return electron.launch({
    executablePath: electronBinary(),
    args: [
      ...rootFlags,
      join(desktopRoot, 'dist', 'main.cjs'),
      `--user-data-dir=${userDataDir ?? freshUserData()}`,
    ],
    env: { ...process.env, ...env } as Record<string, string>,
  })
}

/**
 * The Electron binary `npm ci` unpacked: `dist/electron` on Linux, inside
 * `Electron.app` on a Mac. `path.txt` is the electron package's own answer, the
 * one its `index.js` reads.
 */
function electronBinary(): string {
  const electronDir = join(repoRoot, 'node_modules', 'electron')
  return join(electronDir, 'dist', readFileSync(join(electronDir, 'path.txt'), 'utf8').trim())
}

/**
 * The app `npm run build:desktop` left in `apps/desktop/release`, or null when
 * there is none for this platform and architecture.
 *
 * Whatever is there is tested as it is: a release folder older than the source
 * tests the older build, so build before relying on it.
 */
export function packagedExecutable(): string | null {
  const release = join(desktopRoot, 'release')
  const arm = process.arch === 'arm64'
  const candidates =
    process.platform === 'darwin'
      ? [arm ? 'mac-arm64' : 'mac', 'mac-universal'].map(folder =>
          join(release, folder, 'self.mp3.app', 'Contents', 'MacOS', 'self.mp3'),
        )
      : process.platform === 'win32'
        ? [join(release, 'win-unpacked', 'self.mp3.exe')]
        : [join(release, arm ? 'linux-arm64-unpacked' : 'linux-unpacked', 'selfmp3')]
  return candidates.find(candidate => existsSync(candidate)) ?? null
}

/** Launch the packaged app itself — its own binary, asar and all. */
export async function launchPackaged(executablePath: string): Promise<ElectronApplication> {
  return electron.launch({
    executablePath,
    args: [...rootFlags, `--user-data-dir=${freshUserData()}`],
    env: { ...process.env } as Record<string, string>,
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
