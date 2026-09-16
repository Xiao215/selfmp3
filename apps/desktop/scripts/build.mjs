/**
 * The shell, bundled.
 *
 * Two entry points, CommonJS, `electron` the only external. Everything else —
 * zod, the contract package, electron-updater — goes *into* the bundle on
 * purpose: it is what leaves `apps/desktop/package.json`
 * with no runtime `dependencies` at all, which is what sidesteps
 * electron-builder's trouble collecting packages npm has hoisted to the root of
 * a workspace (electron-builder #2205, #9654). There is nothing to collect.
 *
 * The repository already builds the service worker with esbuild, so this is the
 * bundler it has rather than a second one.
 */
import { build } from 'esbuild'
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const repoRoot = join(root, '..', '..')
const out = join(root, 'dist')

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

/*
 * Whether this build will be signed, decided by `scripts/dist.mjs` from the
 * environment and baked in here.
 *
 * There is no API that asks a running app whether its own signature is one
 * macOS would validate, and the answer decides whether the updater may apply an
 * update at all: Squirrel refuses an update it cannot verify (electron #36640),
 * so an unsigned build must offer the release page instead of a button that
 * fails. Build time is where that is actually known.
 */
const signed = process.env['SELFMP3_SIGNED'] === '1'

const common = {
  bundle: true,
  define: { __SELFMP3_SIGNED__: String(signed) },
  platform: 'node',
  format: 'cjs',
  // Electron 44 runs Node 24; nothing here needs downlevelling.
  target: 'node24',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'info',
}

await build({
  ...common,
  entryPoints: [join(root, 'src', 'main', 'main.ts')],
  outfile: join(out, 'main.cjs'),
})

await build({
  ...common,
  entryPoints: [join(root, 'src', 'preload', 'preload.ts')],
  outfile: join(out, 'preload.cjs'),
  // A sandboxed preload is not a Node module: it has `require` for a short
  // allow-list and nothing else, so everything it uses must be in the file.
  platform: 'browser',
})

/*
 * The renderer, copied in beside the shell rather than built here. It is
 * `apps/app`'s own export, byte for byte the build the server serves and Pages
 * serves — the plan's first ground rule.
 */
const webExport = join(repoRoot, 'apps', 'app', 'dist')
if (!existsSync(join(webExport, 'index.html'))) {
  console.error(
    '\nNo web export at apps/app/dist.\n' + 'Run: npm run export:web --workspace @selfmp3/app\n',
  )
  process.exit(1)
}
cpSync(webExport, join(out, 'web'), { recursive: true })
console.log(`\nShell and renderer in ${out}\n`)
