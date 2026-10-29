import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  INSTALL_PAGE_URL,
  IOS_ASSETS,
  IOS_RELEASE_TAG,
  iosAssetUrl,
  iphoneKey,
  renderIosManifest,
} from '@selfmp3/shared'
import { publishRolling, releaseCommit, run as runIn } from './rolling-release.mjs'

/**
 * The iPhone app for friends: one ad hoc build, signed for every iPhone on the
 * signing team's list, and with `--publish` put on the `ios` release, where the
 * install page and the installed apps find it (packages/shared/src/iosApp.ts).
 *
 *   node scripts/ios-release.mjs [--publish] [--skip-prebuild]
 *
 * How it signs is not in this public repository: it is read from
 * ~/.ios-signing/release.json (or SELFMP3_IOS_SIGNING), which names the team,
 * the certificate and a profile per bundle — see docs/MOBILE.md, "Sharing the
 * iPhone app". The build number is main's commit count (app.config.js), so a
 * published build must be a commit on main.
 */

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(app, 'build/release')
const args = new Set(process.argv.slice(2))
const publish = args.has('--publish')

/** The Xcode targets, by the bundle each signs. */
const TARGETS = { selfmp3: 'com.selfmp3.app', SelfMp3Widget: 'com.selfmp3.app.widget' }

const run = (command, list, options = {}) => runIn(command, list, { cwd: app, ...options })

const signingPath =
  process.env.SELFMP3_IOS_SIGNING ?? resolve(homedir(), '.ios-signing/release.json')
if (!existsSync(signingPath)) {
  throw new Error(
    `No signing setup at ${signingPath}; see docs/MOBILE.md, "Sharing the iPhone app".`,
  )
}
/**
 * { team, method: 'release-testing' | 'debugging', identity, profiles: { [bundle]: name },
 *   withoutAppGroup?: true } — the last for profiles made before the App Group was assigned.
 */
const signing = JSON.parse(readFileSync(signingPath, 'utf8'))
for (const bundle of Object.values(TARGETS)) {
  if (!signing.profiles?.[bundle]) throw new Error(`${signingPath} names no profile for ${bundle}.`)
}

const { commit, build } = releaseCommit(app, { publish })
const { version } = JSON.parse(readFileSync(resolve(app, 'package.json'), 'utf8'))
console.log(`self.mp3 ${version} (${build}), ${commit.slice(0, 8)}`)

if (!args.has('--skip-prebuild')) {
  run('npx', ['expo', 'prebuild', '-p', 'ios', '--no-install'])
  run('pod', ['install'], { cwd: resolve(app, 'ios') })
}

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

// The build number this commit is, in every place iOS reads one: the app's
// Info.plist has it written in by prebuild, which --skip-prebuild leaves at an
// older commit's, and the widget takes CURRENT_PROJECT_VERSION, which prebuild
// leaves at 1. The app compares its own (app.config.js, the same count) with
// ios.json's, so all three must be this one.
run('plutil', ['-replace', 'CFBundleVersion', '-string', String(build), 'ios/selfmp3/Info.plist'])

const settings = [
  'CODE_SIGN_STYLE=Manual',
  `DEVELOPMENT_TEAM=${signing.team}`,
  `CODE_SIGN_IDENTITY=${signing.identity}`,
  ...Object.entries(TARGETS).map(
    ([target, bundle]) => `PROFILE_${target}=${signing.profiles[bundle]}`,
  ),
  // Each target its own profile, by name, with no edit to the generated project.
  'PROVISIONING_PROFILE_SPECIFIER=$(PROFILE_$(TARGET_NAME))',
  `CURRENT_PROJECT_VERSION=${build}`,
]
if (signing.withoutAppGroup) {
  const empty = resolve(out, 'none.entitlements')
  writeFileSync(
    empty,
    '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict/></plist>\n',
  )
  settings.push(`CODE_SIGN_ENTITLEMENTS=${empty}`)
}

const archive = resolve(out, 'selfmp3.xcarchive')
execFileSync(
  'xcodebuild',
  [
    '-workspace',
    'ios/selfmp3.xcworkspace',
    '-scheme',
    'selfmp3',
    '-configuration',
    'Release',
    '-destination',
    'generic/platform=iOS',
    '-derivedDataPath',
    resolve(app, 'build/ddp'),
    '-archivePath',
    archive,
    ...settings,
    'archive',
  ],
  { cwd: app, stdio: 'inherit' },
)

const exportOptions = resolve(out, 'ExportOptions.plist')
writeFileSync(
  exportOptions,
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>${signing.method}</string>
  <key>teamID</key><string>${signing.team}</string>
  <key>signingStyle</key><string>manual</string>
  <key>signingCertificate</key><string>${signing.identity}</string>
  <key>provisioningProfiles</key>
  <dict>
${Object.values(TARGETS)
  .map(bundle => `    <key>${bundle}</key><string>${signing.profiles[bundle]}</string>`)
  .join('\n')}
  </dict>
  <key>thinning</key><string>&lt;none&gt;</string>
</dict>
</plist>
`,
)
execFileSync(
  'xcodebuild',
  [
    '-exportArchive',
    '-archivePath',
    archive,
    '-exportPath',
    out,
    '-exportOptionsPlist',
    exportOptions,
  ],
  { cwd: app, stdio: 'inherit' },
)

const ipa = resolve(out, IOS_ASSETS.app)
if (!existsSync(ipa)) throw new Error(`The export wrote no ${IOS_ASSETS.app} into ${out}.`)
writeFileSync(
  resolve(out, IOS_ASSETS.manifest),
  renderIosManifest({
    url: iosAssetUrl(IOS_ASSETS.app),
    bundleId: TARGETS.selfmp3,
    version,
    title: 'self.mp3',
  }),
)
// The iPhones this build installs on, from the profile inside it: a friend's
// page (apps/doorman/src/device.ts) says Install once theirs is here.
const embedded = execFileSync('security', [
  'cms',
  '-D',
  '-i',
  resolve(archive, 'Products/Applications/selfmp3.app/embedded.mobileprovision'),
])
const udids = execFileSync('plutil', ['-extract', 'ProvisionedDevices', 'json', '-o', '-', '-'], {
  input: embedded,
})
const devices = await Promise.all(JSON.parse(udids.toString()).map(iphoneKey))
writeFileSync(
  resolve(out, IOS_ASSETS.latest),
  `${JSON.stringify(
    { version, build, commit, publishedAt: new Date().toISOString(), devices },
    null,
    2,
  )}\n`,
)
console.log(`Built ${ipa}`)

if (publish) {
  const repo = publishRolling({
    tag: IOS_RELEASE_TAG,
    title: 'iPhone app',
    notes: `self.mp3 ${version} (${build}) for iPhone, from ${commit.slice(0, 8)}. Installed from the install page, not from here: ${INSTALL_PAGE_URL}`,
    commit,
    files: [ipa, resolve(out, IOS_ASSETS.manifest)],
    last: resolve(out, IOS_ASSETS.latest),
  })
  console.log(`Published build ${build} to ${repo}, release ${IOS_RELEASE_TAG}.`)
}
