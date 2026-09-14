/** Spike check 3 — Now Playing and the media keys. */
const { app, BrowserWindow } = require('electron')
const { join } = require('node:path')
const { registerPrivileged, handle } = require('./appScheme.cjs')

const webRoot = process.argv.find(one => one.startsWith('--web-root='))?.slice('--web-root='.length)
const mediaRoot = process.argv.find(one => one.startsWith('--media-root='))?.slice('--media-root='.length)
const userData = process.argv.find(one => one.startsWith('--user-data='))?.slice('--user-data='.length)
const waitSeconds = Number(process.argv.find(one => one.startsWith('--wait='))?.slice('--wait='.length) ?? 0)
if (userData) app.setPath('userData', userData)

registerPrivileged()

app.whenReady().then(async () => {
  handle({ webRoot, mediaRoot, pageOrigin: 'app://selfmp3' })

  const window_ = new BrowserWindow({
    width: 900,
    height: 600,
    show: process.platform === 'darwin',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })

  const result = {
    platform: process.platform,
    // Electron leaves Chromium's HardwareMediaKeyHandling on unless it is
    // disabled here; if it were ever disabled, the media keys would stop
    // reaching `navigator.mediaSession` and `globalShortcut` would be the plan.
    hardwareMediaKeysDisabled: app.commandLine.hasSwitch('disable-features')
      ? app.commandLine.getSwitchValue('disable-features').includes('HardwareMediaKeyHandling')
      : false,
  }

  try {
    await window_.loadURL('app://selfmp3/mediaSession.html')
    result.page = await window_.webContents.executeJavaScript('window.__spike()', true)
    if (waitSeconds > 0) {
      // A human has 60 seconds to press the keyboard's play/pause key.
      await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000))
      result.pressed = await window_.webContents.executeJavaScript('window.__spikePressed()', true)
    }
  } catch (error) {
    result.threw = String(error)
  }

  console.log('SPIKE_RESULT ' + JSON.stringify(result))
  app.exit(0)
})
