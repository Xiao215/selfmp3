/**
 * All six spike checks, in order, with a verdict at the end.
 *
 * `DESKTOP.md`: "If 1 or 2 fails the plan stops here and the reason is written
 * down." So those two decide, and the rest inform.
 */
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { here } from './lib/run.mjs'

const spikeDir = join(here, '..')
const checks = readdirSync(spikeDir)
  .filter(one => /^\d-.*\.mjs$/.test(one))
  .sort()

const results = []
for (const check of checks) {
  const run = spawnSync(process.execPath, [join(spikeDir, check), ...process.argv.slice(2)], { stdio: 'inherit' })
  results.push({ check, ok: run.status === 0 })
}

console.log('\n' + '-'.repeat(60))
for (const one of results) console.log(`${one.ok ? 'pass' : 'FAIL'}  ${one.check}`)
const deciding = results.filter(one => /^[12]-/.test(one.check))
console.log(
  deciding.every(one => one.ok)
    ? '\nChecks 1 and 2 pass, so the plan does not stop at phase 1.\n'
    : '\nCheck 1 or 2 failed: the plan stops here.\n',
)
process.exit(results.every(one => one.ok) ? 0 : 1)
