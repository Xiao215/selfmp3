import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ANDROID_ASSETS, ANDROID_RELEASE_TAG, INSTALL_PAGE_URL } from '@selfmp3/shared'
import { publishRolling, releaseCommit, run as runIn } from './rolling-release.mjs'

/**
 * The Android app for friends: one APK, signed with the app's own key, and
 * with `--publish` put on the `android` release, where the install page and
 * the installed apps find it (packages/shared/src/androidApp.ts).
 *
 *   node scripts/android-release.mjs [--publish]
 *
 * The key is not in this public repository: it is read from
 * ~/.android-signing/release.json (or SELFMP3_ANDROID_SIGNING), and handed to
 * Gradle for plugins/withReleaseSigning.js — see docs/MOBILE.md, "Sharing the
 * Android app". Needs ANDROID_HOME. The build number is main's commit count
 * (app.config.js, written into the project by prebuild, which is why there is
 * no skipping it), so a published build must be a commit on main.
 *
 * arm64 only: every Android phone of the last several years is, and the
 * other three architectures would more than double the download.
 */

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(app, 'build/android')
const publish = process.argv.includes('--publish')

const run = (command, list, options = {}) => runIn(command, list, { cwd: app, ...options })

const signingPath =
  process.env.SELFMP3_ANDROID_SIGNING ?? resolve(homedir(), '.android-signing/release.json')
if (!existsSync(signingPath)) {
  throw new Error(
    `No signing key at ${signingPath}; see docs/MOBILE.md, "Sharing the Android app".`,
  )
}
/** { storeFile, storePassword, keyAlias, keyPassword } */
const signing = JSON.parse(readFileSync(signingPath, 'utf8'))
for (const key of ['storeFile', 'storePassword', 'keyAlias', 'keyPassword']) {
  if (!signing[key]) throw new Error(`${signingPath} has no ${key}.`)
}
if (!process.env.ANDROID_HOME) throw new Error('ANDROID_HOME is not set; see docs/MOBILE.md.')

const { commit, build } = releaseCommit(app, { publish })
const { version } = JSON.parse(readFileSync(resolve(app, 'package.json'), 'utf8'))
console.log(`self.mp3 ${version} (${build}), ${commit.slice(0, 8)}`)

run('npx', ['expo', 'prebuild', '-p', 'android', '--no-install'])

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

run(
  './gradlew',
  [
    // The bundle always: Gradle counts only apps/app as its input, so a change in
    // packages/ alone would ship yesterday's JavaScript.
    ':app:createBundleReleaseJsAndAssets',
    '--rerun',
    ':app:assembleRelease',
    '-PreactNativeArchitectures=arm64-v8a',
    '--console=plain',
  ],
  {
    cwd: resolve(app, 'android'),
    env: {
      ORG_GRADLE_PROJECT_selfmp3StoreFile: signing.storeFile,
      ORG_GRADLE_PROJECT_selfmp3StorePassword: signing.storePassword,
      ORG_GRADLE_PROJECT_selfmp3KeyAlias: signing.keyAlias,
      ORG_GRADLE_PROJECT_selfmp3KeyPassword: signing.keyPassword,
    },
  },
)

const apk = resolve(out, ANDROID_ASSETS.app)
copyFileSync(resolve(app, 'android/app/build/outputs/apk/release/app-release.apk'), apk)

// Signed with the key, not the debug keystore it falls back to: a build signed
// with another key installs over nobody's app.
const buildTools = resolve(process.env.ANDROID_HOME, 'build-tools')
const newest = readdirSync(buildTools)
  .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  .at(-1)
// apksigner, not keytool: from minSdk 24 there is no v1 (JAR) signature for keytool to read.
const signer = run(resolve(buildTools, newest, 'apksigner'), ['verify', '--print-certs', apk], {
  capture: true,
})
const ours = run(
  'keytool',
  [
    '-list',
    '-keystore',
    signing.storeFile,
    '-storepass:env',
    'SELFMP3_STORE_PASSWORD',
    '-alias',
    signing.keyAlias,
  ],
  { capture: true, env: { SELFMP3_STORE_PASSWORD: signing.storePassword } },
)
const fingerprint = text =>
  text
    .match(/SHA-?256[^:]*:\s*([0-9A-F:]+)/i)?.[1]
    .replaceAll(':', '')
    .toLowerCase()
if (!fingerprint(signer) || fingerprint(signer) !== fingerprint(ours)) {
  throw new Error(`${apk} is not signed with the key in ${signingPath}.`)
}

writeFileSync(
  resolve(out, ANDROID_ASSETS.latest),
  `${JSON.stringify({ version, build, commit, publishedAt: new Date().toISOString() }, null, 2)}\n`,
)
console.log(`Built ${apk}`)

if (publish) {
  const repo = publishRolling({
    tag: ANDROID_RELEASE_TAG,
    title: 'Android app',
    notes: `self.mp3 ${version} (${build}) for Android, from ${commit.slice(0, 8)}. Installed from the install page, not from here: ${INSTALL_PAGE_URL}#android`,
    commit,
    files: [apk],
    last: resolve(out, ANDROID_ASSETS.latest),
  })
  console.log(`Published build ${build} to ${repo}, release ${ANDROID_RELEASE_TAG}.`)
}
