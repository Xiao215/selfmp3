/** Spike check 1 — the export runs under `app://`. */
const { app, BrowserWindow } = require('electron')
const { join } = require('node:path')
const { registerPrivileged, handle, seen } = require('./appScheme.cjs')

const repoRoot = join(__dirname, '..', '..', '..', '..', '..')
const webRoot = join(repoRoot, 'apps', 'app', 'dist')

const userData = process.argv.find(one => one.startsWith('--user-data='))?.slice('--user-data='.length)
if (userData) app.setPath('userData', userData)

registerPrivileged()

/** What the page says about itself once the bundle has run. */
const PROBE = `(() => {
  const root = document.getElementById('root') ?? document.body.firstElementChild
  return {
    href: location.href,
    origin: location.origin,
    title: document.title,
    mounted: Boolean(root && root.childElementCount > 0),
    nodes: document.querySelectorAll('*').length,
    text: (document.body.innerText || '').trim().slice(0, 400),
    errors: window.__spikeErrors ?? [],
    secureContext: window.isSecureContext,
    indexedDB: typeof indexedDB !== 'undefined',
  }
})()`

/** The bundle takes a moment after load to mount; poll rather than guess. */
async function settled(contents) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const probe = await contents.executeJavaScript(PROBE)
    if (probe.mounted && probe.text.length > 0) return probe
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  return contents.executeJavaScript(PROBE)
}

app.whenReady().then(async () => {
  handle({ webRoot, mediaRoot: webRoot, pageOrigin: 'app://selfmp3' })

  const window_ = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    backgroundColor: '#14121a',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })

  const failures = []
  window_.webContents.on('did-fail-load', (_event, code, description, url) => {
    failures.push({ code, description, url })
  })
  window_.webContents.on('console-message', (_event, level, message) => {
    if (level >= 3) failures.push({ console: String(message).slice(0, 300) })
  })

  const result = { failures }
  try {
    await window_.loadURL('app://selfmp3/')
    result.boot = await settled(window_.webContents)

    await window_.loadURL('app://selfmp3/playlist/1')
    result.route = await settled(window_.webContents)

    window_.webContents.reload()
    await new Promise(resolve => window_.webContents.once('did-finish-load', resolve))
    result.reload = await settled(window_.webContents)

    result.statuses = [...new Set(seen.statuses)]
  } catch (error) {
    result.threw = String(error)
  }

  console.log('SPIKE_RESULT ' + JSON.stringify(result))
  app.exit(0)
})
