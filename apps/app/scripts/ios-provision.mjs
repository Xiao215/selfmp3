import { Buffer } from 'node:buffer'
import { createPrivateKey, sign } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { DEFAULT_DOORMAN_URL, DOORMAN_PATHS, IphoneListSchema } from '@selfmp3/shared'

/**
 * Apple's side of a friend's iPhone, through the App Store Connect API: every
 * iPhone added on the admin page (the doorman's list, apps/doorman/src/
 * device.ts) is registered with the signing team, and both profiles are made
 * again with every registered iPhone in them. Run before a build, by
 * .github/workflows/ios.yml or by hand:
 *
 *   node scripts/ios-provision.mjs [--check] [--certificate <file>]
 *
 * --check reads and says what it would do, and changes nothing at Apple.
 *
 * It needs a team API key with the Admin role (docs/MOBILE.md, "Sharing the
 * iPhone app"): ASC_KEY_ID, ASC_ISSUER_ID, and ASC_KEY (the .p8's text) or
 * ASC_KEY_PATH. The doorman's list needs SELFMP3_DOORMAN_ADMIN_TOKEN, at
 * SELFMP3_DOORMAN_URL or the default doorman. How it signs is
 * ~/.ios-signing/release.json (or SELFMP3_IOS_SIGNING): the profile names,
 * and `method` for their kind. The certificate the profiles carry is the one
 * in --certificate (PEM or DER); without it, the one in the profile Xcode
 * already has by that name.
 */

const args = process.argv.slice(2)
const check = args.includes('--check')
const certificateArg = args.includes('--certificate')
  ? args[args.indexOf('--certificate') + 1]
  : null

const signingPath =
  process.env.SELFMP3_IOS_SIGNING ?? resolve(homedir(), '.ios-signing/release.json')
const signing = JSON.parse(readFileSync(signingPath, 'utf8'))
const profilesFolder = resolve(homedir(), 'Library/Developer/Xcode/UserData/Provisioning Profiles')
const BUNDLES = ['com.selfmp3.app', 'com.selfmp3.app.widget']
const PROFILE_TYPE = {
  debugging: 'IOS_APP_DEVELOPMENT',
  'release-testing': 'IOS_APP_ADHOC',
}[signing.method]
if (!PROFILE_TYPE) throw new Error(`No profile kind for method ${signing.method}.`)

const need = name => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is not set; see docs/MOBILE.md, "Sharing the iPhone app".`)
  return value
}

// ---------------------------------------------------------------- Apple's API

const keyText = process.env.ASC_KEY_PATH
  ? readFileSync(process.env.ASC_KEY_PATH, 'utf8')
  : need('ASC_KEY')
const key = createPrivateKey(keyText)
const keyId = need('ASC_KEY_ID')
const issuer = need('ASC_ISSUER_ID')

/** A token for twenty minutes, as Apple asks: ES256, raw r‖s. */
function token() {
  const part = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const head = `${part({ alg: 'ES256', kid: keyId, typ: 'JWT' })}.${part({
    iss: issuer,
    iat: now,
    exp: now + 20 * 60,
    aud: 'appstoreconnect-v1',
  })}`
  const signature = sign('sha256', Buffer.from(head), { key, dsaEncoding: 'ieee-p1363' })
  return `${head}.${signature.toString('base64url')}`
}

async function apple(method, path, body) {
  const response = await fetch(`https://api.appstoreconnect.apple.com/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token()}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  })
  if (response.status === 204) return null
  const answer = await response.json().catch(() => ({}))
  if (!response.ok) {
    const why = answer.errors?.map(e => e.detail ?? e.title).join('; ') ?? response.statusText
    throw new Error(`Apple refused ${method} ${path}: ${response.status} ${why}`)
  }
  return answer
}

/** Every page of a list. */
async function all(path) {
  const found = []
  let next = path
  while (next) {
    const page = await apple('GET', next)
    found.push(...page.data)
    next = page.links?.next
      ? page.links.next.replace('https://api.appstoreconnect.apple.com/v1', '')
      : null
  }
  return found
}

// --------------------------------------------------------- what to register

async function addedIphones() {
  const base = process.env.SELFMP3_DOORMAN_URL?.trim() || DEFAULT_DOORMAN_URL
  const response = await fetch(`${base}${DOORMAN_PATHS.iphones}`, {
    headers: { authorization: `Bearer ${need('SELFMP3_DOORMAN_ADMIN_TOKEN')}` },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`The doorman did not give the iPhone list: ${response.status}`)
  return IphoneListSchema.parse(await response.json()).iphones.filter(one => one.state === 'added')
}

/** The serial of the certificate the profiles should carry, as Apple writes it. */
function certificateSerial() {
  let der
  if (certificateArg) {
    const text = readFileSync(certificateArg)
    der = text.includes('-----BEGIN')
      ? execFileSync('openssl', ['x509', '-outform', 'der'], { input: text })
      : text
  } else {
    const name = signing.profiles[BUNDLES[0]]
    const match = execFileSync('grep', ['-l', `<string>${name}</string>`, '-r', profilesFolder], {
      encoding: 'utf8',
    })
      .trim()
      .split('\n')[0]
    if (!match)
      throw new Error(`No profile named ${name} in ${profilesFolder}; pass --certificate.`)
    const plist = execFileSync('security', ['cms', '-D', '-i', match])
    const base64 = execFileSync(
      'plutil',
      ['-extract', 'DeveloperCertificates.0', 'raw', '-o', '-', '-'],
      { input: plist },
    )
    der = Buffer.from(base64.toString().trim(), 'base64')
  }
  const line = execFileSync('openssl', ['x509', '-inform', 'der', '-noout', '-serial'], {
    input: der,
  }).toString()
  return line.split('=')[1].trim().replace(/^0+/, '').toUpperCase()
}

// ---------------------------------------------------------------- the work

const say = text => console.log(check ? `(check) ${text}` : text)
const sameId = (a, b) => a.toUpperCase() === b.toUpperCase()

const wanted = await addedIphones()
const registered = await all('/devices?filter[platform]=IOS&limit=200')
say(
  `${registered.length} iPhones registered with the team; ${wanted.length} added on the admin page.`,
)

for (const iphone of wanted) {
  if (registered.some(device => sameId(device.attributes.udid, iphone.udid))) continue
  const name = (iphone.name || 'A friend').slice(0, 50)
  say(`registering ${name} (${iphone.udid})`)
  if (!check) {
    const made = await apple('POST', '/devices', {
      data: { type: 'devices', attributes: { name, udid: iphone.udid, platform: 'IOS' } },
    })
    registered.push(made.data)
  }
}

const devices = registered.filter(
  device =>
    device.attributes.status === 'ENABLED' &&
    ['IPHONE', 'IPAD'].includes(device.attributes.deviceClass ?? 'IPHONE'),
)
const serial = certificateSerial()
const certificates = await all('/certificates?limit=200')
const certificate = certificates.find(
  one => one.attributes.serialNumber?.replace(/^0+/, '').toUpperCase() === serial,
)
if (!certificate) throw new Error(`The team has no certificate with serial ${serial}.`)
say(`certificate ${certificate.attributes.name} (${certificate.attributes.certificateType})`)

mkdirSync(profilesFolder, { recursive: true })
for (const bundle of BUNDLES) {
  const name = signing.profiles[bundle]
  const ids = await all(`/bundleIds?filter[identifier]=${encodeURIComponent(bundle)}&limit=200`)
  const bundleId = ids.find(one => one.attributes.identifier === bundle)
  if (!bundleId) throw new Error(`The team has no App ID ${bundle}.`)

  const old = await all(`/profiles?filter[name]=${encodeURIComponent(name)}&limit=200`)
  say(`${name}: ${PROFILE_TYPE}, ${devices.length} iPhones, replacing ${old.length}`)
  if (check) continue
  for (const profile of old) await apple('DELETE', `/profiles/${profile.id}`)
  const made = await apple('POST', '/profiles', {
    data: {
      type: 'profiles',
      attributes: { name, profileType: PROFILE_TYPE },
      relationships: {
        bundleId: { data: { type: 'bundleIds', id: bundleId.id } },
        certificates: { data: [{ type: 'certificates', id: certificate.id }] },
        devices: { data: devices.map(device => ({ type: 'devices', id: device.id })) },
      },
    },
  })
  // Xcode's own copies of the profiles just replaced, so the build finds only the new one.
  for (const file of readdirSync(profilesFolder).filter(f => f.endsWith('.mobileprovision'))) {
    const plist = execFileSync('security', ['cms', '-D', '-i', join(profilesFolder, file)])
    const named = execFileSync('plutil', ['-extract', 'Name', 'raw', '-o', '-', '-'], {
      input: plist,
    })
    if (named.toString().trim() === name) rmSync(join(profilesFolder, file))
  }
  const file = join(profilesFolder, `${made.data.attributes.uuid}.mobileprovision`)
  writeFileSync(file, Buffer.from(made.data.attributes.profileContent, 'base64'))
  say(`${name} saved as ${file}`)
}
