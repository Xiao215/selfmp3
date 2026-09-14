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
 *   signed        CSC_LINK + CSC_KEY_PASSWORD. Notarised as well when
 *                 APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER are set.
 *   development   CSC_NAME, a certificate in this Mac's keychain.
 *   ad-hoc        neither. `--config.mac.identity=-` and the looser entitlements.
 *
 * What each tier means is in `signingTier.mjs`.
 */
import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { signingTier } from './signingTier.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const desktop = join(here, '..')

const env = process.env
const { tier, identity, notarising, canInstallUpdates } = signingTier(env)

const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: desktop, stdio: 'inherit', env, shell: false })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

// The whole folder is this build's. electron-builder never empties it, and a
// dmg left from a build under an older name was the one that got installed.
rmSync(join(desktop, 'release'), { recursive: true, force: true })

run(process.execPath, [join(here, 'icon.mjs')])
run(process.execPath, [join(here, 'dmg-background.mjs')])
// The bundle is told which tier it is: the updater's behaviour depends on it,
// and a running app cannot ask about its own signature.
env['SELFMP3_SIGNED'] = canInstallUpdates ? '1' : '0'
run(process.execPath, [join(here, 'build.mjs')])

const args = ['electron-builder', '--config', 'electron-builder.yml']
// Anything after `--` on this script's own command line, so
// `npm run dist -- --dir --linux` still works for a smoke build.
const extra = process.argv.slice(2)
args.push(...extra)

/*
 * On your own Mac, one dmg for this Mac: the release folder is then the app,
 * its dmg, and nothing to choose between. Both chips, the zips, the blockmaps
 * and latest-mac.yml exist for the updater and for a release, and a release is
 * made on CI (`CI` is set on every GitHub runner), which builds them all. Any
 * argument of your own, such as `--linux` or `--x64`, is taken to mean you know
 * what you want, and the defaults step aside.
 */
if (!env['CI'] && extra.length === 0 && process.platform === 'darwin') {
  args.push(
    process.arch === 'arm64' ? '--arm64' : '--x64',
    '--config.mac.target=dmg',
    // No update metadata for a dmg nobody will be updated from.
    '--config.dmg.writeUpdateInfo=false',
  )
}

if (tier === 'ad-hoc') {
  args.push(
    '--config.mac.identity=-',
    '--config.mac.entitlements=build/entitlements.mac.adhoc.plist',
    '--config.mac.entitlementsInherit=build/entitlements.mac.adhoc.plist',
    // Notarisation needs a real signature; asking for it here fails the build
    // rather than producing anything.
    '--config.mac.notarize=false',
  )
}

if (tier === 'development') {
  args.push(
    /*
     * The certificate's full name as `security find-identity` prints it.
     * electron-builder takes any valid identity whose line contains this and
     * is not a Developer ID or Mac App Store certificate, which an Apple
     * Development one is not. The normal entitlements: a certificate's
     * signature is one macOS validates, so the ad-hoc exceptions are not needed.
     */
    `--config.mac.identity=${identity}`,
    // Notarisation is for Developer ID; Apple refuses anything else.
    '--config.mac.notarize=false',
  )
}

console.log(
  `self.mp3 desktop: ${tier === 'signed' ? 'signed' : tier === 'development' ? 'development-signed' : 'ad-hoc'} build` +
    (tier === 'signed' ? `, ${notarising ? 'notarising' : 'not notarised'}` : '') +
    (tier === 'development' ? ` with "${identity}", for this Mac only` : ''),
)
run(join(desktop, '..', '..', 'node_modules', '.bin', 'electron-builder'), args.slice(1))
