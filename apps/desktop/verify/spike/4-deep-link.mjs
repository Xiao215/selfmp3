/**
 * Spike check 4 — the sign-in return.
 *
 * Three things the shell needs: the app claims `selfmp3://`, a second launch
 * hands its URL to the first rather than opening a second window, and a cold
 * launch carries the URL in its own argv. On macOS the running-app delivery
 * goes through `open-url` and is driven by `open "selfmp3://…"`; everywhere
 * else it is `second-instance`, which is what runs here.
 */
import { join } from 'node:path'
import { launch, resultFrom, report, scratchUserData, spikeDir } from './lib/run.mjs'

const main = join(spikeDir, 'main', '4-deep-link.cjs')
const URL_ = 'selfmp3://sign-in#signin-code=TEST-CODE'
const userData = scratchUserData('4')

// The running app.
const first = launch(main, { args: ['--role=first', '--wait=12'], userData, timeoutMs: 60_000 })
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('first instance never became ready')), 40_000)
  first.child.stdout.on('data', chunk => {
    if (String(chunk).includes('SPIKE_READY')) {
      clearTimeout(timer)
      resolve()
    }
  })
})

// The second launch, carrying the URL.
const second = launch(main, { args: ['--role=second', URL_], userData, timeoutMs: 30_000 })
const secondOut = await second.finished
const firstOut = await first.finished

// And a cold launch: no app running, the URL on the command line.
const cold = launch(main, { args: ['--role=cold', '--wait=2', URL_], userData: scratchUserData('4-cold'), timeoutMs: 40_000 })
const coldOut = await cold.finished

const firstResult = resultFrom(firstOut.stdout) ?? {}
const secondResult = resultFrom(secondOut.stdout) ?? {}
const coldResult = resultFrom(coldOut.stdout) ?? {}

const running = (firstResult.delivered ?? []).find(one => one.url === URL_)
const onMac = firstResult.platform === 'darwin'

report('4 — the deep link', [
  { ok: firstResult.gotLock === true, what: 'the first launch takes the single-instance lock' },
  { ok: secondResult.gotLock === false && secondResult.secondInstanceQuit === true, what: 'a second launch does not open a second app', note: 'it hands over and exits' },
  { ok: Boolean(running), what: 'the running app is given the URL', note: JSON.stringify(firstResult.delivered) },
  { ok: coldResult.coldArgv === URL_, what: 'a cold launch finds the URL in its own argv', note: String(coldResult.coldArgv) },
  ...(onMac
    ? [{ ok: firstResult.registered === true, what: 'setAsDefaultProtocolClient("selfmp3") succeeded' }]
    : []),
], {
  'claiming the scheme': onMac
    ? 'run here'
    : `NOT RUNNABLE here: setAsDefaultProtocolClient answered ${String(firstResult.registered)} because Linux claims a scheme through xdg-settings and a .desktop entry, and this container has neither. macOS registers through LaunchServices from the bundle and needs no such thing`,
  'platform': String(firstResult.platform),
  'delivered via': JSON.stringify((firstResult.delivered ?? []).map(one => one.via)),
  'isDefaultProtocolClient': String(firstResult.isDefault),
  'the macOS half': onMac
    ? 'run here'
    : 'NOT RUNNABLE off macOS: `open "selfmp3://…"` and the open-url event. The handler is wired and unexercised; Xiao confirms it on the Mac',
})
