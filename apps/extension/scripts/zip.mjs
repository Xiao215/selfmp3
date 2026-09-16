/**
 * The extension, zipped.
 *
 * What the Chrome Web Store takes, and what anyone else can unzip and load
 * unpacked. `zip` itself rather than a packaging dependency: every machine this
 * runs on has it — macOS, the Linux runners — and the extension's whole point
 * is that it ships as plain files.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
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

try {
  // `-X` leaves out the Mac's own metadata, which the Web Store rejects; the
  // sourcemaps go in, because a listing is reviewed by people reading the code.
  execFileSync('zip', ['-r', '-X', '-q', file, '.'], { cwd: dist, stdio: 'inherit' })
} catch {
  console.error('\n`zip` is not on this machine. Install it, or zip apps/extension/dist by hand.\n')
  process.exit(1)
}

console.log(`\n${file}\n\nLoad it unpacked from apps/extension/dist, or upload this zip.\n`)
