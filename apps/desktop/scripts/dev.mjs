/**
 * A development window: the shell, against Metro on 4601.
 *
 * `npm run dev` at the root has already put the server on 4600 and Metro on
 * 4601; this builds the shell and points it at the latter, so the page reloads
 * as it is edited while the main process stays the built one. The renderer is
 * the same code either way — the only difference is where it is served from,
 * which is the one switch the plan allows.
 */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const repoRoot = join(root, '..', '..')

const devUrl = process.env.SELFMP3_DESKTOP_DEV_URL ?? 'http://localhost:4601'

// The build wants a web export to copy even in development, where the window
// will not look at it; an export that is merely stale is fine here.
const built = spawn(process.execPath, [join(here, 'build.mjs')], { stdio: 'inherit' })
built.on('exit', code => {
  if (code !== 0) process.exit(code ?? 1)

  const electron = join(repoRoot, 'node_modules', 'electron', 'dist', 'electron')
  const child = spawn(electron, [join(root, 'dist', 'main.cjs')], {
    stdio: 'inherit',
    env: { ...process.env, SELFMP3_DESKTOP_DEV_URL: devUrl },
  })
  child.on('exit', code => process.exit(code ?? 0))
})
