/** Spike check 4 — `selfmp3://` reaches the app, running and cold. */
const { app } = require('electron')

const userData = process.argv.find(one => one.startsWith('--user-data='))?.slice('--user-data='.length)
if (userData) app.setPath('userData', userData)

const role = process.argv.find(one => one.startsWith('--role='))?.slice('--role='.length) ?? 'first'
const deepLinkArg = process.argv.find(one => one.startsWith('selfmp3://')) ?? null

const result = { role, platform: process.platform, delivered: [], coldArgv: deepLinkArg }

/**
 * macOS hands a URL to a running app through `open-url`; every other platform
 * hands it to a second process, whose argv the first one is given. The shell
 * needs both paths, so both are wired here and the check says which fired.
 */
app.on('open-url', (event, url) => {
  event.preventDefault()
  result.delivered.push({ via: 'open-url', url })
})

const gotLock = app.requestSingleInstanceLock()
result.gotLock = gotLock

if (!gotLock) {
  // The second launch's whole job is to hand its URL over and go away.
  console.log('SPIKE_RESULT ' + JSON.stringify({ ...result, secondInstanceQuit: true }))
  app.exit(0)
} else {
  app.on('second-instance', (_event, argv) => {
    const url = argv.find(one => one.startsWith('selfmp3://')) ?? null
    result.delivered.push({ via: 'second-instance', url })
  })

  app.whenReady().then(() => {
    // In development Electron is not the bundle, so the protocol has to be
    // claimed with the binary and its entry script named explicitly — the
    // packaged app needs neither argument.
    result.registered = process.defaultApp
      ? app.setAsDefaultProtocolClient('selfmp3', process.execPath, [require('node:path').resolve(process.argv[1])])
      : app.setAsDefaultProtocolClient('selfmp3')
    result.isDefault = app.isDefaultProtocolClient('selfmp3')

    console.log('SPIKE_READY')
    const seconds = Number(process.argv.find(one => one.startsWith('--wait='))?.slice('--wait='.length) ?? 12)
    setTimeout(() => {
      console.log('SPIKE_RESULT ' + JSON.stringify(result))
      app.exit(0)
    }, seconds * 1000)
  })
}
