/**
 * Spike check 1 — the export runs under `app://`.
 *
 * Boots `apps/app/dist` in an Electron window at 1280×800 served by
 * `protocol.handle`, then asks for `app://selfmp3/playlist/1` and reloads it,
 * which is the case a single-page export usually breaks on.
 */
import { launch, resultFrom, report, scratchUserData, spikeDir } from './lib/run.mjs'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const webRoot = join(spikeDir, '..', '..', '..', 'app', 'dist')
if (!existsSync(join(webRoot, 'index.html'))) {
  console.error('no web export: run `npm run export:web --workspace @selfmp3/app` first')
  process.exit(1)
}

const { finished } = launch(join(spikeDir, 'main', '1-app-scheme.cjs'), {
  userData: scratchUserData('1'),
  timeoutMs: 120_000,
})
const { stdout, stderr, timedOut } = await finished
const result = resultFrom(stdout)

if (!result) {
  console.error(stderr.split('\n').slice(-25).join('\n'))
  console.error(timedOut ? 'timed out' : 'no result line')
  process.exit(1)
}

const { boot = {}, route = {}, reload = {}, failures = [] } = result

report('1 — the export runs under app://', [
  { ok: boot.origin === 'app://selfmp3', what: 'the page has a stable app:// origin', note: boot.origin },
  { ok: boot.mounted === true, what: 'the bundle ran and mounted a tree', note: `${boot.nodes} nodes` },
  { ok: (boot.text ?? '').length > 0, what: 'the app drew something', note: JSON.stringify((boot.text ?? '').slice(0, 80)) },
  { ok: boot.secureContext === true, what: 'a secure context (Web Crypto, service workers, storage)' },
  { ok: boot.indexedDB === true, what: 'IndexedDB is there for the caches' },
  { ok: route.mounted === true, what: 'app://selfmp3/playlist/1 resolves to the app', note: route.href },
  { ok: reload.mounted === true && reload.href === route.href, what: 'reloading that URL comes back to it', note: reload.href },
  { ok: failures.length === 0, what: 'no load failure and no console error', note: JSON.stringify(failures).slice(0, 300) },
], { 'handler statuses': JSON.stringify(result.statuses) })
