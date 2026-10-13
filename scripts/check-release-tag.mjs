import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * A release tag must name the version its workspace's package.json says.
 *
 * The desktop app's updater reads the installed app's package.json version
 * and compares it with the release's; the extension's manifest and zip take
 * theirs from it too. A tag pushed without the bump released an app that
 * called itself the old version. The release workflows run this first:
 *
 *   node scripts/check-release-tag.mjs apps/desktop desktop-v desktop-v1.2.0
 */

/** The problem with releasing `tag` from a package at `version`, or null when there is none. */
export function releaseTagProblem(version, prefix, tag) {
  if (!tag.startsWith(prefix)) return `${tag} is not a ${prefix}* tag`
  const tagged = tag.slice(prefix.length)
  return tagged === version
    ? null
    : `${tag} names ${tagged}, but the package's version is ${version}: bump package.json or retag`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [workspace = '', prefix = '', tag = ''] = process.argv.slice(2)
  const { version } = JSON.parse(readFileSync(join(workspace, 'package.json'), 'utf8'))
  const problem = releaseTagProblem(version, prefix, tag)
  if (problem) {
    console.error(`::error::${problem}`)
    process.exit(1)
  }
  console.log(`${tag} releases ${workspace} ${version}`)
}
