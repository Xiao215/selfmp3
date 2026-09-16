/*
 * The server's own page.
 *
 * Plain DOM on purpose. This page exists so the server can be set up and looked
 * at, and it is the one surface that must work before anything else does —
 * before a bucket, before a Google account, before the app has been opened
 * anywhere. Giving it a framework and a build step would make the thing you
 * reach for when nothing works the thing most likely to be broken.
 *
 * Everything it does is `/api/cloud`, which is the same API Settings → Cloud
 * used to call from inside the app.
 */

const TOKEN_KEY = 'selfmp3.admin.token'

/** Long enough that a sign-in which came back is not called lost (the app's LINK_GRACE_MS). */
const LINK_GRACE_MS = 8_000

const state = {
  /** The last `/api/cloud` we were given, or null before the first answer. */
  cloud: null,
  /** The last `/api/health`. */
  health: null,
  /** Showing the bucket form, even though a bucket is already connected. */
  editing: false,
  /** One line under the Cloud card: what just happened, or what went wrong. */
  notice: null,
  /** This server asked us for its token, and we do not have it. */
  needsToken: false,
  /** The card's markup as last drawn, so an unchanged poll leaves the DOM alone. */
  drawn: null,
  /** When Google was handed the sign-in, to tell "waiting" from "did not come back". */
  waitingSince: null,
  timer: null,
}

// ---------------------------------------------------------------- talking to the server

/**
 * One request to this server.
 *
 * A token is never in play when this page is opened on the server's own
 * machine: the server does not ask a request from there for one, which is the
 * ordinary case and the reason the form below is rarely seen. Opened from
 * another computer it is asked for, and then this page has to say it.
 *
 * A refusal is only read as "the token is wrong" on a read: the cloud routes
 * answer a bucket that refused its key with 401 as well, and prompting for this
 * server's token because Backblaze did not like a key would be nonsense. Every
 * read goes through `/api/cloud`, so a token this page does not have is always
 * caught there first, before there is anything to write.
 *
 * It is kept in `sessionStorage`, not `localStorage`: a token typed into an
 * admin page should not outlive the tab.
 */
async function request(path, options = {}) {
  const method = options.method ?? 'GET'
  const token = sessionStorage.getItem(TOKEN_KEY)
  const headers = {}
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers['Authorization'] = `Bearer ${token}`

  const response = await fetch(path, {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })

  if (response.status === 401 && method === 'GET') {
    state.needsToken = true
    throw new Error('This server is refusing us; it wants its token.')
  }

  if (!response.ok) {
    let message = `The server answered ${response.status}.`
    try {
      const body = await response.json()
      if (body && typeof body.error === 'string') message = body.error
      else if (body && typeof body.message === 'string') message = body.message
    } catch {
      /* Not JSON: the status is all there is to say. */
    }
    throw new Error(message)
  }

  return response.status === 204 ? null : response.json()
}

// ---------------------------------------------------------------- shaping numbers

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  const units = ['kB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

function formatRelative(iso) {
  if (!iso) return 'never'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'never'
  const seconds = Math.round((Date.now() - then) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

/** Text into markup. Every value below is the server's or the person's, never trusted raw. */
function escape(value) {
  return String(value).replace(
    /[&<>"']/g,
    character =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  )
}

function stateLabel(cloud) {
  if (cloud.signingIn) return cloud.signInNeedsCode ? 'finishing sign-in' : 'waiting for Google'
  switch (cloud.state) {
    case 'off':
      return cloud.account ? 'no bucket yet' : 'off'
    case 'syncing':
      return 'uploading'
    case 'error':
      return 'needs attention'
    default:
      return cloud.songs.inCloud >= cloud.songs.total ? 'up to date' : 'waiting'
  }
}

// ---------------------------------------------------------------- drawing

function renderLibrary() {
  const health = state.health
  const cloud = state.cloud
  const songs = health?.songCount ?? cloud?.songs.total ?? null
  const rows = []

  rows.push(
    row(
      'Songs',
      'Everything this server has scanned. Drop audio into the folder and it appears.',
      songs === null ? '—' : plural(songs, 'song'),
    ),
  )
  if (health?.libraryPath) {
    rows.push(row('Folder', 'Where the audio lives on this computer.', health.libraryPath, true))
  }
  document.getElementById('library-body').innerHTML = rows.join('')
}

function row(label, hint, value, code = false) {
  return `<div class="row">
    <div>
      <p class="row-label">${escape(label)}</p>
      <p class="row-hint">${escape(hint)}</p>
    </div>
    <span class="row-value${code ? ' code' : ''}">${escape(value)}</span>
  </div>`
}

/**
 * A button. It is never drawn mid-action — `run` disables the ones already on
 * screen rather than redrawing them — so there is no "working" state here.
 */
function button(action, label, { variant = '', disabled = false } = {}) {
  return `<button class="button ${variant}" data-action="${action}"${
    disabled ? ' disabled' : ''
  }>${escape(label)}</button>`
}

function noticeMarkup() {
  if (!state.notice) return ''
  return `<p class="notice js-notice ${state.notice.tone}">${escape(state.notice.text)}</p>`
}

/**
 * Put the notice where it belongs without redrawing the card.
 *
 * What goes wrong here is nearly always something to correct and try again — a
 * mistyped key, a bucket that refused — so the form has to survive being told.
 */
function paintNotice(body) {
  body.querySelector('.js-notice')?.remove()
  if (!state.notice) return
  const line = document.createElement('p')
  line.className = `notice js-notice ${state.notice.tone}`
  line.textContent = state.notice.text
  body.append(line)
}

/**
 * Whether the card is being worked on, and should be left where it is.
 *
 * The focused field is the obvious half. The other half is a form that has been
 * filled in and let go of — pressing Connect moves focus to the button, and a
 * poll landing in that moment would have wiped the key a breath before it was
 * read.
 */
function holdingOn(body) {
  const active = document.activeElement
  if (
    active &&
    body.contains(active) &&
    (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')
  ) {
    return true
  }
  return [...body.querySelectorAll('form input')].some(input => input.value.trim() !== '')
}

function renderCloud({ force = false } = {}) {
  const body = document.getElementById('cloud-body')
  const cloud = state.cloud
  document.getElementById('cloud-state').textContent = state.needsToken
    ? 'locked'
    : cloud
      ? stateLabel(cloud)
      : ''

  // Never redraw over someone's hands. The page polls while a sign-in or an
  // upload is going on, and a redraw replaces the whole card — which would take
  // a half-typed application key, or the code being copied in from Google's
  // page, with it. Whatever is being typed into wins until it is let go of.
  if (!force && holdingOn(body)) return

  const markup = state.needsToken
    ? tokenForm()
    : !cloud
      ? `<p class="muted">Could not ask this server about the cloud.</p>`
      : cloud.signingIn
        ? waitingForGoogle(cloud)
        : cloud.connected && !state.editing
          ? connected(cloud)
          : cloud.doormanUrl && !cloud.account
            ? signIn(cloud)
            : bucketForm(cloud)

  // Most polls change nothing. Replacing the card anyway would throw away the
  // focus ring, close a native autofill menu and make every element new, twice
  // a second, for no visible difference.
  if (markup === state.drawn) return
  state.drawn = markup
  body.innerHTML = markup
  wire(body)
}

/**
 * This page was opened from somewhere other than the server's own machine, so
 * it has to say the token. Asked for in the card rather than through `prompt`,
 * which is a dialog a browser may refuse to show at all.
 */
function tokenForm() {
  return `
    <p class="lead">
      This page is open from another computer, so the server will not say anything about itself
      until it hears its token. It is in the server's own log at startup, or in
      <span class="code">SELFMP3_AUTH_TOKEN</span> if you set one. Kept for this tab only.
    </p>
    <form data-form="token">
      <label class="field">
        <span>Token</span>
        <input name="token" type="password" autocomplete="off" />
      </label>
      <div class="row last">
        <p class="row-hint">Nothing is stored on the server; this is the token it already has.</p>
        <div class="actions">${button('use-token', 'Unlock', { variant: 'primary' })}</div>
      </div>
    </form>
    ${noticeMarkup()}`
}

function signIn(cloud) {
  const again = Boolean(cloud.account)
  return `
    <p class="lead">
      Keep your library in a storage bucket that belongs to your Google account, so every device
      you sign in on gets the same music and your changes — even while this server is off.
    </p>
    <div class="row last">
      <div>
        <p class="row-label">${again ? 'Sign in again' : 'Google account'}</p>
        <p class="row-hint">${
          again
            ? 'Publishing stopped until you do. Nothing in the bucket is lost.'
            : 'Sign in first. The bucket is connected to the account after that, just once.'
        }</p>
      </div>
      <div class="actions">${button('signin', 'Sign in with Google', { variant: 'primary' })}</div>
    </div>
    ${noticeMarkup()}`
}

/**
 * Google has the sign-in. It comes back on its own when this page was opened on
 * the computer running the server; reached at any other address the doorman
 * will not redirect here — it shows the code instead — so the code can be typed.
 */
function waitingForGoogle(cloud) {
  const lost = state.waitingSince !== null && Date.now() - state.waitingSince > LINK_GRACE_MS
  return `
    <div class="row">
      <div>
        <p class="row-label">${lost ? 'Didn’t come back?' : 'Waiting for Google'}</p>
        <p class="row-hint">${
          lost
            ? 'Finish where Google opened. If it ended on a page showing a code, type that code here.'
            : 'Finish signing in where Google opened. This comes back by itself.'
        }</p>
      </div>
      <div class="actions">
        ${button('signin', 'Start again')}
        ${button('cancel-signin', 'Cancel')}
      </div>
    </div>
    <form class="row last" data-form="code">
      <label class="field" style="flex:1">
        <span>The code Google showed, if it showed one</span>
        <input name="code" autocomplete="off" spellcheck="false" placeholder="ABCD-1234" />
      </label>
      <div class="actions">${button('enter-code', 'Finish signing in')}</div>
    </form>
    ${noticeMarkup()}
    ${cloud.lastError ? `<p class="notice error">${escape(cloud.lastError)}</p>` : ''}`
}

function connected(cloud) {
  const target = cloud.target
  const host = target ? target.endpoint.replace(/^https?:\/\//, '') : ''
  const folder = target ? (target.prefix ? `${target.bucket}/${target.prefix}` : target.bucket) : ''
  const syncing = cloud.state === 'syncing'
  const progress = cloud.progress

  const uploading =
    syncing && progress && progress.total > 0
      ? `<div class="meter"><i style="width:${Math.round(
          (progress.done / progress.total) * 100,
        )}%"></i></div>
         <p class="row-hint">Uploading ${Math.min(progress.done + 1, progress.total)} of ${
           progress.total
         }${progress.current ? ` — ${escape(progress.current)}` : ''}</p>`
      : syncing
        ? `<p class="row-hint">Checking what changed…</p>`
        : ''

  return `
    <p class="lead">
      Publishing to <span class="code">${escape(folder)}</span> at
      <span class="code">${escape(host)}</span>. Every song goes up once with its cover and
      lyrics, and a snapshot of the library follows each change.
    </p>
    <div class="row">
      <div>
        <p class="row-label">In the cloud</p>
        <p class="row-hint">${escape(
          `${cloud.songs.inCloud} of ${plural(cloud.songs.total, 'song')} · ${formatBytes(
            cloud.bytesInCloud,
          )} · last published ${formatRelative(cloud.lastSnapshotAt)}`,
        )}</p>
        ${uploading}
      </div>
      <div class="actions">
        ${button('sync', syncing ? 'Uploading…' : 'Publish now', { disabled: syncing })}
      </div>
    </div>
    <div class="row last">
      <div>
        <p class="row-label">${cloud.account ? 'Google account' : 'Connection'}</p>
        <p class="row-hint">${escape(
          `${
            cloud.account ? `Signed in as ${cloud.account.email}` : `Key ${target?.keyIdHint ?? ''}`
          } · this server is ${cloud.deviceId ?? 'unnamed'} in the bucket`,
        )}</p>
      </div>
      <div class="actions">
        ${button('edit', 'Change bucket…')}
        ${button('disconnect', cloud.account ? 'Sign out' : 'Disconnect', { variant: 'danger' })}
      </div>
    </div>
    ${cloud.state === 'error' && cloud.lastError ? `<p class="notice error">${escape(cloud.lastError)}</p>` : ''}
    ${noticeMarkup()}`
}

function bucketForm(cloud) {
  const target = cloud.target
  const signedIn = Boolean(cloud.account)
  const field = (name, label, hint, value = '', type = 'text') => `
    <label class="field">
      <span>${escape(label)} — ${escape(hint)}</span>
      <input name="${name}" type="${type}" value="${escape(value)}" autocomplete="off"
             autocapitalize="off" spellcheck="false" />
    </label>`

  return `
    <p class="lead">${
      signedIn
        ? `Signed in as ${escape(cloud.account.email)}. Now the bucket that belongs to this account. Backblaze B2 is free up to 10 GB: a private bucket, and an application key for it with read and write access. The doorman tries the key, then keeps it sealed; no device sees it again.`
        : 'Keep your library in a storage bucket you own, so your other devices can get new songs and edits while this server is off. Backblaze B2 is free up to 10 GB: create a private bucket, then an application key for it with read and write access.'
    }</p>
    <form data-form="bucket">
      ${field('endpoint', 'Endpoint', 'on the bucket’s own page in B2', target?.endpoint.replace(/^https:\/\//, '') ?? '')}
      ${field('region', 'Region', 'only when the endpoint does not name one', target?.region ?? '')}
      ${field('bucket', 'Bucket', 'its name, not its ID', target?.bucket ?? '')}
      ${field('prefix', 'Folder', 'everything goes under this folder', target?.prefix ?? 'selfmp3')}
      ${field('keyId', 'Key ID', target ? `currently ${target.keyIdHint}` : 'B2 calls it keyID', '')}
      ${field('applicationKey', 'Application key', 'B2 shows it once, as you make it', '', 'password')}
      <div class="row last">
        <p class="row-hint">
          The key is tried before anything is saved: listed, written to and read back.
        </p>
        <div class="actions">
          ${cloud.connected ? button('cancel-edit', 'Cancel') : ''}
          ${button('connect', 'Connect', { variant: 'primary' })}
        </div>
      </div>
    </form>
    ${noticeMarkup()}`
}

// ---------------------------------------------------------------- doing things

function wire(body) {
  for (const element of body.querySelectorAll('[data-action]')) {
    element.addEventListener('click', event => {
      event.preventDefault()
      void act(element.dataset.action, element.closest('form'))
    })
  }
  const bucket = body.querySelector('form[data-form="bucket"]')
  if (bucket) {
    bucket.addEventListener('submit', event => {
      event.preventDefault()
      void act('connect', bucket)
    })
  }
  const token = body.querySelector('form[data-form="token"]')
  if (token) {
    token.addEventListener('submit', event => {
      event.preventDefault()
      void act('use-token', token)
    })
  }
  const code = body.querySelector('form[data-form="code"]')
  if (code) {
    code.addEventListener('submit', event => {
      event.preventDefault()
      void act('enter-code', code)
    })
  }
}

/** A sign-in attempt id nobody could guess: a guessed one is a session somebody could claim. */
function attemptId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

async function act(action, form) {
  state.notice = null
  try {
    switch (action) {
      case 'signin': {
        if (!state.cloud?.doormanUrl) throw new Error('No doorman is set up for this server.')
        // The window is opened from the press itself: one opened after an
        // await is a popup, and a browser blocks it.
        const attempt = attemptId()
        const params = new URLSearchParams({ attempt, return: `${location.origin}/` })
        window.open(`${state.cloud.doormanUrl}/v1/auth/start?${params}`, '_blank', 'noopener')
        await run(() => request('/api/cloud/signin', { method: 'POST', body: { attempt } }))
        state.waitingSince = Date.now()
        break
      }
      case 'cancel-signin':
        await run(() => request('/api/cloud/signin', { method: 'DELETE' }))
        state.waitingSince = null
        break
      case 'enter-code': {
        const code = form?.elements.code.value.trim()
        if (!code) throw new Error('Type the code Google showed.')
        await run(() => request('/api/cloud/signin/code', { method: 'POST', body: { code } }))
        state.waitingSince = null
        state.notice = { tone: 'good', text: 'Signed in.' }
        break
      }
      case 'connect': {
        const values = Object.fromEntries(
          [...new FormData(form).entries()].map(([key, value]) => [key, String(value).trim()]),
        )
        if (!values.region) delete values.region
        // Signed in: the doorman keeps the key for the account. Otherwise the
        // bucket is this server's own, and the key stays on it.
        const path = state.cloud?.account ? '/api/cloud/storage' : '/api/cloud'
        await run(() => request(path, { method: 'PUT', body: values }))
        state.editing = false
        state.notice = { tone: 'good', text: 'Connected. Publishing starts now.' }
        break
      }
      case 'sync':
        await run(() => request('/api/cloud/sync', { method: 'POST' }))
        break
      case 'disconnect': {
        const account = state.cloud?.account
        const asked = window.confirm(
          account
            ? `Sign this server out of ${account.email}? Your music stays in the bucket.`
            : 'Stop publishing? Everything already in the bucket stays there.',
        )
        if (!asked) return
        await run(() => request('/api/cloud', { method: 'DELETE' }))
        state.editing = false
        break
      }
      case 'use-token': {
        const typed = form?.elements.token.value.trim()
        if (!typed) throw new Error('Type the token this server answers to.')
        sessionStorage.setItem(TOKEN_KEY, typed)
        state.needsToken = false
        // Emptied before the redraw, or the token still sitting in the field
        // would count as someone typing and hold the card where it is.
        form.reset()
        await poll()
        renderCloud({ force: true })
        return
      }
      case 'edit':
        state.editing = true
        break
      case 'cancel-edit':
        state.editing = false
        break
    }
    renderCloud({ force: true })
  } catch (error) {
    state.notice = { tone: 'error', text: error instanceof Error ? error.message : String(error) }
    // In place: whatever was typed is what has to be corrected.
    paintNotice(document.getElementById('cloud-body'))
    enable(document.getElementById('cloud-body'))
  }
  schedule()
}

/**
 * Run one action, and take the status it answers with.
 *
 * The buttons are disabled where they stand instead of the card being redrawn
 * with them disabled, for the same reason as the notice: a redraw mid-action
 * would empty the form that is being submitted.
 */
async function run(call) {
  const body = document.getElementById('cloud-body')
  for (const button of body.querySelectorAll('button')) button.disabled = true
  const answer = await call()
  if (answer && typeof answer === 'object') state.cloud = answer
}

function enable(body) {
  for (const button of body.querySelectorAll('button')) button.disabled = false
}

// ---------------------------------------------------------------- keeping up to date

async function poll() {
  try {
    const [cloud, health] = await Promise.all([
      request('/api/cloud').catch(() => null),
      request('/api/health').catch(() => null),
    ])
    // `/api/cloud` is the authority on whether we are let in: `/api/health` is
    // answered without a token on purpose, so its success says nothing.
    if (cloud) {
      state.cloud = cloud
      state.needsToken = false
    }
    if (health) state.health = health
    const foot = document.getElementById('reachable')
    foot.textContent = cloud || health ? '' : 'Not answering.'
    document.getElementById('version').textContent = health ? `self.mp3 ${health.version}` : ''
  } catch {
    /* Drawn from whatever was last known; the footer says when nothing is. */
  }
  renderLibrary()
  renderCloud()
  schedule()
}

/** Often while something is happening, rarely while nothing is. */
function schedule() {
  clearTimeout(state.timer)
  const cloud = state.cloud
  const quick = cloud && (cloud.signingIn || cloud.state === 'syncing')
  state.timer = setTimeout(() => void poll(), quick ? 2_000 : 10_000)
}

/**
 * Coming back from Google with the code in the fragment.
 *
 * The doorman sends the browser back here when this page was opened on the
 * computer running the server — it allows loopback addresses for exactly this
 * — and puts the code after a `#`. It is taken out of the address straight
 * away, so a reload cannot try to spend it twice.
 */
async function takeSignInCode() {
  const code = /(?:^|[#&])signin-code=([0-9A-Za-z-]{1,32})/.exec(location.hash)?.[1]
  if (!code) return
  history.replaceState(null, '', location.pathname + location.search)
  try {
    state.cloud = await request('/api/cloud/signin/code', { method: 'POST', body: { code } })
    state.waitingSince = null
    state.notice = { tone: 'good', text: 'Signed in.' }
  } catch (error) {
    state.notice = {
      tone: 'error',
      text: `Signing in didn’t work: ${error instanceof Error ? error.message : 'try again'}`,
    }
  }
}

void (async () => {
  await takeSignInCode()
  await poll()
})()
