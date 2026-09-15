/**
 * The extension, bundled.
 *
 * Three entry points — the background worker, the popup and the options page —
 * each one file with everything it imports inside it. An extension loads no code
 * from anywhere but its own folder (Manifest V3 forbids remote code), and there
 * is nothing at run time to resolve a package from. esbuild, which the service
 * worker and the desktop shell already use.
 *
 * The stylesheets are their own entry points rather than imports from the
 * scripts: TypeScript checks what a side-effect import resolves to, and a `.css`
 * file is not something it can.
 *
 * The manifest is copied with the package's version written into it, so the
 * version lives in one place.
 */
import { build } from 'esbuild'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const repoRoot = join(root, '..', '..')
const out = join(root, 'dist')

for (const pkg of ['shared', 'client']) {
  if (!existsSync(join(repoRoot, 'packages', pkg, 'dist', 'index.js'))) {
    console.error(
      `\nNo build of packages/${pkg}.\n` +
        'Run: npm run build:extension (it builds the packages first)\n',
    )
    process.exit(1)
  }
}

rmSync(out, { recursive: true, force: true })
mkdirSync(join(out, 'icons'), { recursive: true })

await build({
  entryPoints: {
    background: join(root, 'src', 'background', 'index.ts'),
    popup: join(root, 'src', 'popup', 'main.tsx'),
    options: join(root, 'src', 'options', 'main.tsx'),
  },
  outdir: out,
  bundle: true,
  platform: 'browser',
  format: 'esm',
  // The manifest's minimum_chrome_version.
  target: 'chrome120',
  jsx: 'automatic',
  // React's production build: its development one checks every render twice.
  define: { 'process.env.NODE_ENV': '"production"' },
  sourcemap: true,
  logLevel: 'info',
})

await build({
  entryPoints: {
    popup: join(root, 'src', 'popup', 'popup.css'),
    options: join(root, 'src', 'options', 'options.css'),
  },
  outdir: out,
  bundle: true,
  logLevel: 'info',
})

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))
writeFileSync(join(out, 'manifest.json'), `${JSON.stringify({ ...manifest, version }, null, 2)}\n`)

copyFileSync(join(root, 'src', 'popup', 'popup.html'), join(out, 'popup.html'))
copyFileSync(join(root, 'src', 'options', 'options.html'), join(out, 'options.html'))
copyFileSync(
  join(repoRoot, 'apps', 'app', 'public', 'icons', 'icon-192.png'),
  join(out, 'icons', 'icon-192.png'),
)

console.log(`\nThe extension is in ${out}. Load it unpacked from chrome://extensions.\n`)
