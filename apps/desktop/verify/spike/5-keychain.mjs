/**
 * Spike check 5 — the keychain.
 *
 * A string is sealed with `safeStorage`, written to `userData/secrets.json`,
 * and opened again by a *second launch* against the same `userData`, which is
 * the part that matters: a value that only round-trips inside one process
 * proves nothing about a token surviving a quit.
 *
 * On macOS the key lives in the login keychain. On Linux it lives wherever the
 * desktop's secret service is, and with no secret service at all Chromium falls
 * back to `basic_text`, which is obfuscation rather than encryption. That
 * fallback is what runs in this container, and the check says so rather than
 * pretending a keychain was exercised.
 */
import { join } from 'node:path'
import { launch, resultFrom, report, scratchUserData, spikeDir } from './lib/run.mjs'

const main = join(spikeDir, 'main', '5-keychain.cjs')
const userData = scratchUserData('5')

const write = resultFrom((await launch(main, { args: ['--pass=write'], userData, timeoutMs: 60_000 }).finished).stdout) ?? {}
const read = resultFrom((await launch(main, { args: ['--pass=read'], userData, timeoutMs: 60_000 }).finished).stdout) ?? {}

const realBackend = read.backend !== 'basic_text' && read.backend !== 'unknown'

const onMac = read.backend === 'darwin'

report('5 — the keychain', [
  { ok: write.available === true, what: 'safeStorage.isEncryptionAvailable()' },
  { ok: write.threw === undefined, what: 'encryptString did not throw', note: String(write.threw ?? '') },
  { ok: read.fileExists === true, what: 'the file is still there after a quit', note: String(read.file) },
  { ok: read.matches === true, what: 'a second launch opens it again', note: read.threw ?? `${String(read.opened).slice(0, 24)}…` },
  // Strength, not shape. Off macOS this container has a plain-text store, so
  // asserting these here would be asserting the accommodation, not the product.
  ...(onMac
    ? [
        { ok: write.looksEncrypted === true, what: 'the sealed bytes are not the plain string' },
        { ok: read.rawOnDisk === false, what: 'the token is not on disk in the clear' },
      ]
    : []),
], {
  'backend': String(read.backend),
  'strength': onMac ? 'the login keychain' : `NOT checked here: the store is plain text, so only the seal → quit → open contract was exercised`,
  'what this proves': realBackend
    ? 'a real OS-backed store'
    : `NOT the Mac's keychain: this container has no secret service, so Chromium used ${String(read.backend)}, which obfuscates rather than encrypts. The API contract — seal, quit, open — is what was exercised here, and that is the part the shell depends on. Xiao's Mac is where isEncryptionAvailable() means the login keychain`,
})
