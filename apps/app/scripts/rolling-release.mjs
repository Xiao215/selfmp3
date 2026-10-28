import { execFileSync } from 'node:child_process'
import { REPOSITORY } from '@selfmp3/shared'

/**
 * What the phone release scripts share (ios-release.mjs, android-release.mjs):
 * the commit being built and its build number, and putting the files on a
 * release replaced in place, so each keeps one address.
 */

export const run = (command, list, options = {}) =>
  execFileSync(command, list, {
    cwd: options.cwd,
    stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', ...options.env },
  })
    ?.toString()
    .trim()

/**
 * The commit and its build number, main's commit count (app.config.js). A
 * build to publish must be a commit on main as it is, or its number would
 * not follow main's.
 */
export function releaseCommit(cwd, { publish }) {
  const commit = run('git', ['rev-parse', 'HEAD'], { cwd, capture: true })
  const build = Number(run('git', ['rev-list', '--count', 'HEAD'], { cwd, capture: true }))
  if (publish) {
    if (run('git', ['status', '--porcelain'], { cwd, capture: true }) !== '') {
      throw new Error('The checkout has changes; a published build is a commit as it is on main.')
    }
    run('git', ['fetch', '--quiet', 'origin', 'main'], { cwd })
    try {
      run('git', ['merge-base', '--is-ancestor', commit, 'FETCH_HEAD'], { cwd })
    } catch {
      throw new Error('HEAD is not on main yet; its build number would not follow main’s.')
    }
  }
  return { commit, build }
}

/**
 * Puts `files` on the release `tag`, made at `commit` if there is none yet,
 * then `last`: the file the installed apps read, so none hears of a build
 * before it can be downloaded. Never the latest release: the Mac app's
 * updater reads that one (packages/shared/src/releases.ts).
 */
export function publishRolling({ tag, title, notes, commit, files, last }) {
  const repo = `${REPOSITORY.owner}/${REPOSITORY.name}`
  let exists = true
  try {
    run('gh', ['release', 'view', tag, '--repo', repo], { capture: true })
  } catch {
    exists = false
  }
  if (exists) {
    // The tag moves with each build; the release, and its files' addresses, stay.
    run(
      'gh',
      [
        'api',
        '-X',
        'PATCH',
        `repos/${repo}/git/refs/tags/${tag}`,
        '-f',
        `sha=${commit}`,
        '-F',
        'force=true',
      ],
      { capture: true },
    )
  } else {
    run('gh', [
      'release',
      'create',
      tag,
      '--repo',
      repo,
      '--target',
      commit,
      '--title',
      title,
      '--notes',
      notes,
      '--prerelease',
      '--latest=false',
    ])
  }
  run('gh', ['release', 'upload', tag, ...files, '--repo', repo, '--clobber'])
  run('gh', ['release', 'upload', tag, last, '--repo', repo, '--clobber'])
  run('gh', [
    'release',
    'edit',
    tag,
    '--repo',
    repo,
    '--notes',
    notes,
    '--prerelease',
    '--latest=false',
  ])
  return repo
}
