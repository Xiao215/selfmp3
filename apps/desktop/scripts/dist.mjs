/**
 * Build the app, then package it at whichever signing tier the environment
 * allows.
 *
 * The tier is decided here rather than in `electron-builder.yml` because it is
 * a fact about the machine, not about the product: the same commit produces a
 * signed app on a Mac with a certificate and an ad-hoc one on a Mac without,
 * and neither is a mistake. What must not happen is a build that *looks* signed
 * and is not — electron-updater refuses to apply an update to a signature it
 * cannot verify (electron #36640), so the tier has to be visible.
 *
 *   signed   CSC_LINK + CSC_KEY_PASSWORD. Notarised as well when
 *            APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER are set.
 *   ad-hoc   neither. `--config.mac.identity=-` and the looser entitlements.
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const desktop = join(here, '..')

const env = process.env
const signed = Boolean(env['CSC_LINK'] && env['CSC_KEY_PASSWORD'])
const notarising = Boolean(env['APPLE_API_KEY'] && env['APPLE_API_KEY_ID'] && env['APPLE_API_ISSUER'])

const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: desktop, stdio: 'inherit', env, shell: false })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run(process.execPath, [join(here, 'icon.mjs')])
// The bundle is told which tier it is: the updater's behaviour depends on it,
// and a running app cannot ask about its own signature.
env['SELFMP3_SIGNED'] = signed ? '1' : '0'
run(process.execPath, [join(here, 'build.mjs')])

const args = ['electron-builder', '--config', 'electron-builder.yml']
// Anything after `--` on this script's own command line, so
// `npm run dist -- --dir --linux` still works for a smoke build.
args.push(...process.argv.slice(2))

if (!signed) {
  args.push(
    '--config.mac.identity=-',
    '--config.mac.entitlements=build/entitlements.mac.adhoc.plist',
    '--config.mac.entitlementsInherit=build/entitlements.mac.adhoc.plist',
    // Notarisation needs a real signature; asking for it here fails the build
    // rather than producing anything.
    '--config.mac.notarize=false',
  )
}

console.log(
  `self.mp3 desktop: ${signed ? 'signed' : 'ad-hoc'} build` +
    (signed ? `, ${notarising ? 'notarising' : 'not notarised'}` : ''),
)
run(join(desktop, '..', '..', 'node_modules', '.bin', 'electron-builder'), args.slice(1))
