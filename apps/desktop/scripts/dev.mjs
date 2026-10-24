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

import { DEFAULT_LOCAL_WEB_URL } from '@selfmp3/shared'

import { electronBinary } from './electronPath.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const devUrl = process.env.SELFMP3_DESKTOP_DEV_URL ?? DEFAULT_LOCAL_WEB_URL

// The shell alone: the window loads the page from Metro, so there is no web
// export to copy in, and none needs to exist.
const built = spawn(process.execPath, [join(here, 'build.mjs'), '--no-web'], {
  stdio: 'inherit',
})
built.on('exit', code => {
  if (code !== 0) process.exit(code ?? 1)

  /*
   * Whatever was asked for on the way in, handed straight to Electron. The
   * one that matters is `--user-data-dir`: the single-instance lock is keyed on `userData`, so two
   * development windows at once are two `userData` directories, and without a
   * way to name one the second launch hands its arguments to the first and
   * exits. Electron reads its own switches wherever they appear, which is why
   * these can follow the app path.
   *
   * npm eats a bare `--`, so it is
   * `npm run dev --workspace @selfmp3/desktop -- --user-data-dir=…`, or
   * `node apps/desktop/scripts/dev.mjs --user-data-dir=…`.
   */
  const child = spawn(
    electronBinary(),
    [join(root, 'dist', 'main.cjs'), ...process.argv.slice(2)],
    {
      stdio: 'inherit',
      env: { ...process.env, SELFMP3_DESKTOP_DEV_URL: devUrl },
    },
  )
  child.on('exit', code => process.exit(code ?? 0))
})
