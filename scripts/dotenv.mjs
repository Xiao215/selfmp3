import { spawnSync } from 'node:child_process'
import { dirname, isAbsolute, join, resolve } from 'node:path'

/**
 * A `.env` for this machine's own settings — the signing certificate's name,
 * the server's token — read into the environment before a script looks there.
 *
 * Git never sees it (`.gitignore`), so it lives in one place: the main
 * checkout. A worktree branched from it has no `.env` of its own, and would
 * otherwise build ad-hoc and ask for the keychain password again; so the
 * worktree's own `.env` is read first, and the main checkout's after it,
 * which git names for any worktree (`--git-common-dir`). A variable already
 * in the environment wins over either file, and a value set once in the
 * first file is not overwritten by the second.
 *
 * The server has the same reader in TypeScript (`apps/server/src/dotenv.ts`),
 * since it cannot import from here; keep the two in step.
 */

/**
 * Where to look, in order: the checkout `cwd` is in, then the main checkout
 * when `cwd` is a worktree of it. Pure, for the tests: `toplevel` and
 * `commonDir` are what `git rev-parse --show-toplevel --git-common-dir` say.
 */
export function dotEnvCandidates(toplevel, commonDir) {
  const files = []
  if (toplevel) files.push(join(toplevel, '.env'))
  if (commonDir) {
    // `.git` in the main checkout, an absolute `…/main/.git` from a worktree.
    const gitDir = isAbsolute(commonDir) ? commonDir : resolve(toplevel ?? '.', commonDir)
    const main = join(dirname(gitDir), '.env')
    if (!files.includes(main)) files.push(main)
  }
  return files
}

/** Read every `.env` that applies to `cwd`; the paths that were read. */
export function loadDotEnv(cwd = process.cwd()) {
  const asked = spawnSync('git', ['rev-parse', '--show-toplevel', '--git-common-dir'], {
    cwd,
    encoding: 'utf8',
    shell: false,
  })
  if (asked.status !== 0) return []
  const [toplevel, commonDir] = asked.stdout.trim().split('\n')
  const loaded = []
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
