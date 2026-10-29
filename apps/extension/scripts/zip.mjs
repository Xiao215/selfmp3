/**
 * The extension, zipped.
 *
 * What the Chrome Web Store takes, and what anyone else can unzip and load
 * unpacked. `zip` itself rather than a packaging dependency: every machine this
 * runs on has it — macOS, the Linux runners — and the extension's whole point
 * is that it ships as plain files.
 */
import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const dist = join(root, 'dist')
const releases = join(root, 'release')

if (!existsSync(join(dist, 'manifest.json'))) {
  console.error('\nNothing built at apps/extension/dist.\nRun: npm run build:extension\n')
  process.exit(1)
}

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
mkdirSync(releases, { recursive: true })
const file = join(releases, `selfmp3-extension-${version}.zip`)
rmSync(file, { force: true })

/*
 * What is zipped is dist with one thing taken out of its manifest: the
 * development pages on localhost that may talk to the extension
 * (`externally_connectable`). A build on this machine keeps them, for
 * `npm run dev:web` and the client download harness; the extension people
 * install answers the web app's own address only — not whatever else
 * someone runs on those ports, which with the YouTube sign-in on could ask
 * YouTube as them.
 */
const staged = mkdtempSync(join(tmpdir(), 'selfmp3-extension-'))
cpSync(dist, staged, { recursive: true })
const manifestPath = join(staged, 'manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
manifest.externally_connectable.matches = manifest.externally_connectable.matches.filter(
  match => !new URL(match.replace(/\*$/, '')).hostname.startsWith('localhost'),
)
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

try {
  // `-X` leaves out the Mac's own metadata, which the Web Store rejects; the
  // sourcemaps go in, because a listing is reviewed by people reading the code.
  execFileSync('zip', ['-r', '-X', '-q', file, '.'], { cwd: staged, stdio: 'inherit' })
} catch {
  console.error('\n`zip` is not on this machine. Install it, or zip apps/extension/dist by hand.\n')
  process.exit(1)
} finally {
  rmSync(staged, { recursive: true, force: true })
}

console.log(`\n${file}\n\nLoad it unpacked from apps/extension/dist, or upload this zip.\n`)
