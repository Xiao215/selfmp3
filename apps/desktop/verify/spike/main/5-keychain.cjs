/** Spike check 5 — `safeStorage`, and whether it survives a relaunch. */
const { app, safeStorage } = require('electron')
const { readFileSync, writeFileSync, existsSync } = require('node:fs')
const { join } = require('node:path')

const userData = process.argv.find(one => one.startsWith('--user-data='))?.slice('--user-data='.length)
if (userData) app.setPath('userData', userData)
const pass = process.argv.find(one => one.startsWith('--pass='))?.slice('--pass='.length) ?? 'write'

/*
 * On Linux `isEncryptionAvailable()` is false unless a secret service answers,
 * and this container has none, so the API cannot be exercised at all without
 * asking for the `basic` store. That is a container accommodation and nothing
 * the shell ever does: on macOS the answer is the login keychain and there is
 * no switch to pass.
 */
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('password-store', 'basic')
  // Without this, `isEncryptionAvailable()` is false here and nothing can be
  // exercised at all. It makes the store plain text, which is why the strength
  // checks below only run on macOS.
  safeStorage.setUsePlainTextEncryption?.(true)
}
const secret = 'doorman-session:9f2c1a44-a-token-nobody-else-should-read'

app.whenReady().then(() => {
  const file = join(app.getPath('userData'), 'secrets.json')
  const result = {
    pass,
    available: safeStorage.isEncryptionAvailable(),
    backend: process.platform === 'linux' ? safeStorage.getSelectedStorageBackend?.() ?? 'unknown' : process.platform,
    file,
  }

  try {
    if (pass === 'write') {
      const sealed = safeStorage.encryptString(secret)
      // Base64 in a JSON document, which is what the shell will keep in
      // `userData/secrets.json`.
      writeFileSync(file, JSON.stringify({ 'cloud.session': sealed.toString('base64') }, null, 2))
      result.wroteBytes = sealed.length
      result.looksEncrypted = !sealed.toString('utf8').includes('doorman-session')
    } else {
      result.fileExists = existsSync(file)
      const stored = JSON.parse(readFileSync(file, 'utf8'))['cloud.session']
      result.opened = safeStorage.decryptString(Buffer.from(stored, 'base64'))
      result.matches = result.opened === secret
      result.rawOnDisk = readFileSync(file, 'utf8').includes('doorman-session')
    }
  } catch (error) {
    result.threw = String(error)
  }

  console.log('SPIKE_RESULT ' + JSON.stringify(result))
  app.exit(0)
})
