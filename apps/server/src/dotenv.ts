import { spawnSync } from 'node:child_process'
import path from 'node:path'

/**
 * A `.env` for this machine's own settings — the server's token, a bucket's
 * keys — read into the environment before the configuration is.
 *
 * Git never sees it (`.gitignore`), so it lives in one place: the main
 * checkout. A worktree branched from it has none of its own, so the
 * worktree's `.env` is read first and the main checkout's after it, which git
 * names for any worktree (`--git-common-dir`). A variable already in the
 * environment wins over either file — `SELFMP3_PROFILE=dev npm run dev:api`
 * stays the dev profile whatever the file says — and a value from the first
 * file is not overwritten by the second.
 *
 * The desktop build has the same reader as a script (`scripts/dotenv.mjs`),
 * which cannot import from here; keep the two in step.
 */

/**
 * Where to look, in order: the checkout `cwd` is in, then the main checkout
 * when `cwd` is a worktree of it. Pure, for the tests: `toplevel` and
 * `commonDir` are what `git rev-parse --show-toplevel --git-common-dir` say.
 */
export function dotEnvCandidates(
  toplevel: string | undefined,
  commonDir: string | undefined,
): string[] {
  const files: string[] = []
  if (toplevel) files.push(path.join(toplevel, '.env'))
  if (commonDir) {
    // `.git` in the main checkout, an absolute `…/main/.git` from a worktree.
    const gitDir = path.isAbsolute(commonDir) ? commonDir : path.resolve(toplevel ?? '.', commonDir)
    const main = path.join(path.dirname(gitDir), '.env')
    if (!files.includes(main)) files.push(main)
  }
  return files
}

/** Read every `.env` that applies to `cwd`; the paths that were read. */
export function loadDotEnv(cwd = process.cwd()): string[] {
  const asked = spawnSync('git', ['rev-parse', '--show-toplevel', '--git-common-dir'], {
    cwd,
    encoding: 'utf8',
    shell: false,
  })
  if (asked.status !== 0) return []
  const [toplevel, commonDir] = asked.stdout.trim().split('\n')
  const loaded: string[] = []
  for (const file of dotEnvCandidates(toplevel, commonDir)) {
    try {
      process.loadEnvFile(file)
      loaded.push(file)
    } catch {
      // No file there: the environment as it is.
    }
  }
  return loaded
}
