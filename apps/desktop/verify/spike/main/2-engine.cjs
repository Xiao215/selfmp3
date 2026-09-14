/** Spike check 2 — the real `engine.web.ts` plays and analyses from `app://`. */
const { app, BrowserWindow } = require('electron')
const { join } = require('node:path')
const { registerPrivileged, handle, seen } = require('./appScheme.cjs')

const webRoot = process.argv.find(one => one.startsWith('--web-root='))?.slice('--web-root='.length)
const mediaRoot = process.argv.find(one => one.startsWith('--media-root='))?.slice('--media-root='.length)
const userData = process.argv.find(one => one.startsWith('--user-data='))?.slice('--user-data='.length)
if (userData) app.setPath('userData', userData)

registerPrivileged()

app.whenReady().then(async () => {
  handle({ webRoot, mediaRoot, pageOrigin: 'app://selfmp3' })

  const window_ = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })

  const result = {}
  try {
    await window_.loadURL('app://selfmp3/engine.html')
    result.page = await window_.webContents.executeJavaScript('window.__spike()', true)
  } catch (error) {
    result.threw = String(error)
  }

  // What the protocol handler was actually asked for, read from the main
  // process rather than inferred from the page.
  result.rangeHeaders = seen.ranges.filter(one => one !== null)
  result.statuses = [...new Set(seen.statuses)]

  console.log('SPIKE_RESULT ' + JSON.stringify(result))
  app.exit(0)
})
