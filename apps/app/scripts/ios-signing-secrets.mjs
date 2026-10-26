import { execFileSync } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { REPOSITORY } from '@selfmp3/shared'

/**
 * Hands this Mac's iPhone signing to the repository's secrets, for
 * .github/workflows/ios.yml. Run on the Mac that signs (docs/MOBILE.md,
 * "Sharing the iPhone app"), again whenever the profiles or the certificate
 * change:
 *
 *   node scripts/ios-signing-secrets.mjs [--check]
 *
 * From ~/.ios-signing/release.json (or SELFMP3_IOS_SIGNING) it takes the
 * profile named for each bundle from Xcode's profiles, the certificate those
 * profiles were made with, and the key in ~/.ios-signing that matches it, and
 * sets IOS_SIGNING, IOS_P12, IOS_P12_PASSWORD, IOS_PROFILE_APP and
 * IOS_PROFILE_WIDGET with `gh secret set`. Nothing is printed: the key goes
 * from here to GitHub's encrypted secrets and nowhere else.
 */

const folder = resolve(homedir(), '.ios-signing')
const signingPath = process.env.SELFMP3_IOS_SIGNING ?? join(folder, 'release.json')
const signing = JSON.parse(readFileSync(signingPath, 'utf8'))
const profilesFolder = resolve(homedir(), 'Library/Developer/Xcode/UserData/Provisioning Profiles')
const repo = `${REPOSITORY.owner}/${REPOSITORY.name}`
/** Everything but the upload: says what it would set. */
const check = process.argv.includes('--check')

const sh = (command, args, input) =>
  execFileSync(command, args, {
    input,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  })

/** One field of a profile's plist; data comes out as base64. */
const field = (plist, key) =>
  sh('plutil', ['-extract', key, 'raw', '-o', '-', '-'], plist).toString().trim()

/** The profiles Xcode has, with the fields that tell them apart. */
function profiles() {
  return readdirSync(profilesFolder)
    .filter(name => name.endsWith('.mobileprovision'))
    .map(name => {
      const path = join(profilesFolder, name)
      const plist = sh('security', ['cms', '-D', '-i', path])
      return {
        path,
        name: field(plist, 'Name'),
        team: field(plist, 'TeamIdentifier.0'),
        created: field(plist, 'CreationDate'),
        certificate: field(plist, 'DeveloperCertificates.0'),
      }
    })
}

/** The newest of the team's profiles with this name. */
function profileNamed(name, all) {
  const found = all
    .filter(p => p.name === name && p.team === signing.team)
    .sort((a, b) => b.created.localeCompare(a.created))[0]
  if (!found)
    throw new Error(`No profile named ${name} for team ${signing.team} in ${profilesFolder}.`)
  return found
}

/** A public key, as PEM, from a certificate (DER on stdin) or a private key's file. */
const publicKey = (args, input) => sh('openssl', args, input).toString().trim()

const all = profiles()
const app = profileNamed(signing.profiles['com.selfmp3.app'], all)
const widget = profileNamed(signing.profiles['com.selfmp3.app.widget'], all)

// The certificate both profiles were made with, and the key that goes with it.
const certificate = Buffer.from(app.certificate, 'base64')
const certificateKey = publicKey(['x509', '-inform', 'der', '-noout', '-pubkey'], certificate)
const keyFile = readdirSync(folder)
  .filter(name => name.endsWith('.key'))
  .map(name => join(folder, name))
  .find(path => publicKey(['pkey', '-in', path, '-pubout']) === certificateKey)
if (!keyFile) throw new Error(`No key in ${folder} matches the certificate the profiles carry.`)

const scratch = mkdtempSync(join(tmpdir(), 'selfmp3-signing-'))
try {
  const pem = join(scratch, 'certificate.pem')
  const p12 = join(scratch, 'signing.p12')
  writeFileSync(pem, sh('openssl', ['x509', '-inform', 'der', '-outform', 'pem'], certificate))
  const password = randomBytes(18).toString('base64url')
  // -legacy: the macOS keychain cannot read OpenSSL 3's default encryption.
  sh(
    'openssl',
    [
      'pkcs12',
      '-export',
      '-legacy',
      '-inkey',
      keyFile,
      '-in',
      pem,
      '-out',
      p12,
      '-passout',
      'stdin',
    ],
    password,
  )

  const secrets = {
    IOS_SIGNING: JSON.stringify(signing),
    IOS_P12: readFileSync(p12).toString('base64'),
    IOS_P12_PASSWORD: password,
    IOS_PROFILE_APP: readFileSync(app.path).toString('base64'),
    IOS_PROFILE_WIDGET: readFileSync(widget.path).toString('base64'),
  }
  for (const [name, value] of Object.entries(secrets)) {
    if (!check) sh('gh', ['secret', 'set', name, '--repo', repo], value)
    console.log(`${check ? 'would set' : 'set'} ${name} (${value.length} characters)`)
  }
  console.log(
    `${check ? 'Ready: signing' : 'Signing'} for ${signing.team} (${signing.method}) ${check ? 'can go' : 'is'} on ${repo}, with the key ${keyFile.replace(homedir(), '~')}.`,
  )
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
