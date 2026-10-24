/*
 * The owner's admin page (docs/features/admin.md): Data, Access and Server.
 *
 * Plain browser JavaScript with no build step. What the server knows it asks
 * of this page's own address (`/api/admin/*`); what the doorman knows — who
 * may sign in, and what it counted — it asks of the doorman straight from the
 * browser, signed in as the owner. The doorman's address and paths come from
 * the server, so nothing here spells one.
 */

const SESSION_KEY = 'selfmp3-admin-session'
const ATTEMPT_KEY = 'selfmp3-admin-attempt'
const RANGE_KEY = 'selfmp3-admin-range'
const CODE_FRAGMENT = 'signin-code'
const TABS = ['data', 'access', 'server']
const RANGES = [7, 30, 90]
const REFRESH_MS = 60_000

const state = {
  tab: tabOf(location.pathname),
  days: readRange(),
  server: null,
  data: null,
  doormanStats: null,
  access: null,
  requests: null,
  /** Why the doorman would not answer the owner, in words, or null. */
  doormanProblem: null,
  busy: false,
  error: null,
}

// ---------- Small helpers ----------

function tabOf(pathname) {
  const name = pathname.replace(/^\/+|\/+$/g, '')
  return TABS.includes(name) ? name : 'data'
}

function readRange() {
  try {
    const saved = Number(localStorage.getItem(RANGE_KEY))
    return RANGES.includes(saved) ? saved : 30
  } catch {
    return 30
  }
}

function escape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const fmt = n => Math.round(n).toLocaleString('en-US')
const sum = list => list.reduce((total, n) => total + n, 0)

function plural(count, one, many) {
  return `${fmt(count)} ${count === 1 ? one : many}`
}

function duration(ms) {
  if (ms === null || ms === undefined) return '—'
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes} m ${String(seconds % 60).padStart(2, '0')} s`
}

function bytes(n) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = n
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit += 1
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

function shortDay(day) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

function relative(iso) {
  const ms = Date.now() - Date.parse(iso)
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

// ---------- Talking to the server and the doorman ----------

async function ask(path) {
  const response = await fetch(path, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(await problemOf(response))
  return response.json()
}

async function problemOf(response) {
  try {
    const body = await response.json()
    if (body && typeof body.error === 'string') return body.error
  } catch {
    // Not JSON: the status will do.
  }
  return `the server answered ${response.status}`
}

function session() {
  try {
    return localStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
}

function keepSession(token) {
  try {
    if (token) localStorage.setItem(SESSION_KEY, token)
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    // A private window: signed in until the tab closes.
  }
}

/** Ask the doorman as the owner. Null when signed out; throws on any other refusal. */
async function doorman(pathOrUrl, init = {}) {
  const door = state.server?.doorman
  const token = session()
  if (!door || !token) return null
  const response = await fetch(`${door.url}${pathOrUrl}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  })
  if (response.status === 401) {
    keepSession(null)
    state.doormanProblem = null
    return null
  }
  if (response.status === 403) {
    state.doormanProblem =
      'This Google account is not the owner of this self.mp3. Sign in with the owner’s.'
    return null
  }
  if (!response.ok) throw new Error(await problemOf(response))
  return response.status === 204 ? {} : response.json()
}

async function signIn() {
  const random = crypto.getRandomValues(new Uint8Array(16))
  const attempt = [...random].map(b => b.toString(16).padStart(2, '0')).join('')
  try {
    sessionStorage.setItem(ATTEMPT_KEY, attempt)
  } catch {
    // Without it the code cannot be claimed here; the doorman shows it instead.
  }
  const { url } = await ask(`/api/admin/signin?attempt=${attempt}&tab=${state.tab}`)
  location.assign(url)
}

/** Back from Google with a code in the address: claim it for a session. */
async function claimSignIn() {
  const match = new RegExp(`${CODE_FRAGMENT}=([0-9A-Z]{8})`).exec(location.hash)
  if (!match) return
  history.replaceState(null, '', location.pathname)
  let attempt = null
  try {
    attempt = sessionStorage.getItem(ATTEMPT_KEY)
    sessionStorage.removeItem(ATTEMPT_KEY)
  } catch {
    // No attempt to claim with.
  }
  const door = state.server?.doorman
  if (!attempt || !door) return
  const response = await fetch(`${door.url}${door.paths.claim}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ attempt, code: match[1] }),
  })
  const body = await response.json().catch(() => null)
  if (response.ok && body?.status === 'signed-in') keepSession(body.token)
  else state.error = body?.error ?? 'That sign-in did not go through. Try again.'
}

async function signOut() {
  keepSession(null)
  state.access = null
  state.requests = null
  state.doormanStats = null
  state.doormanProblem = null
  render()
}

// ---------- Loading ----------

async function load() {
  state.error = null
  try {
    if (state.tab === 'data') {
      const paths = state.server?.doorman?.paths
      const [data, stats] = await Promise.all([
        ask(`/api/admin/data?days=${state.days}`),
        paths ? doorman(`${paths.stats}?days=${state.days}`).catch(() => null) : null,
      ])
      state.data = data
      state.doormanStats = stats
    } else if (state.tab === 'access') {
      await loadAccess()
    } else {
      state.server = await ask('/api/admin/server')
    }
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error)
  }
}

async function loadAccess() {
  const paths = state.server?.doorman?.paths
  if (!paths) return
  const [access, requests] = await Promise.all([
    doorman(paths.access),
    doorman(paths.accessRequests),
  ])
  state.access = access
  state.requests = requests?.requests ?? null
}

// ---------- Charts, one scale each ----------

function niceMax(v) {
  for (const step of [
    5, 10, 20, 25, 40, 50, 60, 80, 100, 150, 200, 250, 300, 400, 500, 600, 800, 1000,
  ]) {
    if (v <= step) return step
  }
  const magnitude = 10 ** Math.floor(Math.log10(v))
  return Math.ceil(v / magnitude) * magnitude
}

function every(n) {
  return n <= 7 ? 1 : n <= 31 ? 7 : 21
}

/** Stacked bars by day, with an optional line on its own 0–`lineMax` scale. */
function bars(days, series, colors, options = {}) {
  const {
    h = 150,
    W = 640,
    line = null,
    lineMax = 100,
    lineColor = 'var(--text-primary)',
    lineUnit = '%',
  } = options
  const n = days.length
  const padL = 34
  const padR = line ? 36 : 6
  const padB = 18
  const padT = 8
  const totals = days.map((_, i) => sum(series.map(s => s[i])))
  const max = niceMax(Math.max(...totals, 1))
  const plotH = h - padB - padT
  const bw = (W - padL - padR) / n
  const y = v => padT + plotH - (v / max) * plotH
  const gap = n <= 7 ? 0.3 : 0.18
  let svg = `<svg class="chart anim" viewBox="0 0 ${W} ${h}" role="img" aria-label="${escape(options.label ?? 'Chart')}">`
  for (const t of [0, max / 2, max]) {
    svg += `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}"/><text x="${padL - 6}" y="${y(t) + 3}" text-anchor="end">${fmt(t)}</text>`
  }
  days.forEach((day, i) => {
    let base = 0
    series.forEach((s, si) => {
      if (s[i] <= 0) return
      const top = y(base + s[i])
      const bottom = y(base)
      svg += `<rect class="bar" style="--i:${i}" x="${padL + i * bw + bw * gap}" y="${top}" width="${bw * (1 - 2 * gap)}" height="${Math.max(bottom - top, 0.5)}" rx="${Math.min(3, bw * 0.2)}" fill="${colors[si]}"/>`
      base += s[i]
    })
    if ((n - 1 - i) % every(n) === 0) {
      svg += `<text x="${padL + i * bw + bw / 2}" y="${h - 4}" text-anchor="middle">${shortDay(day)}</text>`
    }
  })
  if (line) {
    const ly = v => padT + plotH - (Math.min(v, lineMax) / lineMax) * plotH
    const points = line.map((v, i) => `${padL + i * bw + bw / 2},${ly(v)}`).join(' ')
    svg += `<polyline class="line" points="${points}" fill="none" stroke="${lineColor}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`
    for (const t of [0, lineMax / 2, lineMax]) {
      svg += `<text x="${W - padR + 6}" y="${ly(t) + 3}">${fmt(t)}${lineUnit}</text>`
    }
  }
  return `${svg}</svg>`
}

/** A share by day, 0–100 %, with a red mark on the days in `marks`. */
function shareLine(days, values, marks) {
  const n = days.length
  const W = 420
  const h = 150
  const padL = 36
  const padB = 18
  const padT = 14
  const min = 0
  const plotH = h - padB - padT
  const step = (W - padL - 6) / Math.max(n - 1, 1)
  const y = v => padT + plotH - ((v - min) / (100 - min)) * plotH
  let svg = `<svg class="chart anim" viewBox="0 0 ${W} ${h}" role="img" aria-label="YouTube downloads that worked, by day">`
  for (const t of [0, 50, 100]) {
    svg += `<line class="grid" x1="${padL}" x2="${W - 6}" y1="${y(t)}" y2="${y(t)}"/><text x="${padL - 6}" y="${y(t) + 3}" text-anchor="end">${t}%</text>`
  }
  const points = values.map((v, i) => (v === null ? null : [padL + i * step, y(v)]))
  const drawn = points.filter(Boolean)
  if (drawn.length > 1) {
    svg += `<polyline class="line" points="${drawn.map(p => p.join(',')).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>`
  }
  for (const p of drawn)
    svg += `<circle cx="${p[0]}" cy="${p[1]}" r="${n <= 31 ? 2.5 : 1.5}" fill="var(--accent)"/>`
  marks.forEach((held, i) => {
    if (!held) return
    const x = padL + i * step
    svg += `<line x1="${x}" x2="${x}" y1="${padT - 6}" y2="${y(min)}" stroke="var(--danger)" stroke-width="1.5" stroke-dasharray="3 3"/><circle cx="${x}" cy="${padT - 6}" r="3.5" fill="var(--danger)"/>`
  })
  const each = n <= 7 ? 2 : n <= 31 ? 10 : 30
  days.forEach((day, i) => {
    if ((n - 1 - i) % each === 0)
      svg += `<text x="${padL + i * step}" y="${h - 4}" text-anchor="middle">${shortDay(day)}</text>`
  })
  return `${svg}</svg>`
}

const BAND_LABELS = ['< 30 s', '30 s–1 m', '1–2 m', '2–3 m', '3–5 m', '5–10 m', '10 m +']
const BAND_LIMITS = [30_000, 60_000, 120_000, 180_000, 300_000, 600_000]

/** Imports that worked, by how long they took, with the median and 90 % marked. */
function histogram(bands, medianMs, p90Ms) {
  const n = bands.length
  const W = 420
  const h = 190
  const padL = 30
  const padB = 22
  const padT = 34
  const max = niceMax(Math.max(...bands, 1))
  const plotH = h - padB - padT
  const bw = (W - padL - 6) / n
  const y = v => padT + plotH - (v / max) * plotH
  let svg = `<svg class="chart anim" viewBox="0 0 ${W} ${h}" role="img" aria-label="Songs by how long they took to import">`
  for (const t of [0, max / 2, max]) {
    svg += `<line class="grid" x1="${padL}" x2="${W - 6}" y1="${y(t)}" y2="${y(t)}"/><text x="${padL - 6}" y="${y(t) + 3}" text-anchor="end">${fmt(t)}</text>`
  }
  bands.forEach((count, i) => {
    const x = padL + i * bw + bw * 0.12
    const w = bw * 0.76
    const slow = i >= 4
    svg += `<rect class="bar" style="--i:${i * 4}" x="${x}" y="${y(count)}" width="${w}" height="${Math.max(y(0) - y(count), 0.5)}" rx="6" fill="${slow ? 'color-mix(in oklab, var(--warning) 75%, var(--surface1))' : 'var(--accent)'}"/>`
    if (count > 0)
      svg += `<text class="value" x="${x + w / 2}" y="${y(count) - 5}" text-anchor="middle">${fmt(count)}</text>`
    svg += `<text x="${x + w / 2}" y="${h - 6}" text-anchor="middle">${BAND_LABELS[i]}</text>`
  })
  const at = ms => {
    const band = BAND_LIMITS.findIndex(limit => ms < limit)
    const i = band === -1 ? BAND_LIMITS.length : band
    const low = i === 0 ? 0 : BAND_LIMITS[i - 1]
    const high = BAND_LIMITS[i] ?? low * 2
    return padL + (i + Math.min(1, (ms - low) / (high - low))) * bw
  }
  for (const [ms, label] of [
    [medianMs, 'median'],
    [p90Ms, '9 in 10 done'],
  ]) {
    if (ms === null) continue
    const x = at(ms)
    svg += `<line class="marker" x1="${x}" x2="${x}" y1="4" y2="${y(0)}"/><text class="marker-text" x="${x + 4}" y="12">${label}</text>`
  }
  return `${svg}</svg>`
}

function hbars(rows, options = {}) {
  const max = options.max ?? Math.max(...rows.map(r => r.value), 1)
  const cols = options.labelWidth
    ? ` style="grid-template-columns:minmax(90px,${options.labelWidth}) minmax(0,1fr) 56px"`
    : ''
  return `<div class="hbars anim">${rows
    .map(
      r =>
        `<div class="hbar"${cols}><span class="t">${escape(r.label)}</span><span class="b"><i class="${r.tone ?? options.tone ?? ''}" style="width:${(r.value / max) * 100}%"></i></span><span class="n">${escape(r.shown ?? fmt(r.value))}</span></div>`,
    )
    .join('')}</div>`
}

// ---------- Words for what the server and doorman say ----------

const FAILURES = {
  'youtube-blocked': 'YouTube asked the server to slow down',
  unavailable: 'Video unavailable, private or age-restricted',
  'no-match': 'No match found for the song',
  bucket: 'The bucket refused the upload',
  timeout: 'Timed out',
  other: 'Something else',
}
const SOURCES = {
  youtube: 'YouTube',
  'youtube-music': 'YouTube Music',
  netease: '网易云音乐',
  spotify: 'Spotify, found on YouTube',
  other: 'Other links',
}
const STEPS = {
  waiting: ['Waiting in line', 'var(--surface3)'],
  resolving: ['Finding the song', 'var(--accent-dim)'],
  downloading: ['Downloading', 'var(--accent)'],
  converting: ['Converting', 'color-mix(in oklab, var(--accent) 60%, var(--surface1))'],
  lyrics: ['Lyrics', 'color-mix(in oklab, var(--good) 70%, var(--surface1))'],
  saving: ['Saving', 'var(--text-muted)'],
  uploading: [
    'Uploading to the bucket',
    'color-mix(in oklab, var(--warning) 70%, var(--surface1))',
  ],
}
const FEATURES = {
  'now-playing': 'Now Playing',
  search: 'Search',
  lyrics: 'Lyrics',
  import: 'Import',
  ask: 'Ask',
  'up-next': 'Up next',
  'share-link': 'Share link',
  room: 'Room',
}
const SMART = {
  ask: 'Ask',
  tidy: 'Tidy',
  describe: 'Picks',
  refine: 'Refining a pick',
  tags: 'Tag review',
  fix: 'Fix a song',
  import: 'Import names',
  written: 'Written notes',
  check: 'Settings check',
}
const APP_ERRORS = {
  'cloud-unreachable': 'App showed “Can’t reach the cloud”',
  'server-away': 'App showed the server as away',
  'bucket-full': 'App showed the bucket as full for the day',
}
const READ_APPS = {
  web: 'Web',
  computer: 'Computer',
  phone: 'Phone',
  extension: 'Extension',
  server: 'Server',
  lent: 'Lent to rooms and links',
}

// ---------- Views ----------

function head(title, sub, end = '') {
  return `<div class="page-head"><div><h1 class="page-title">${escape(title)}</h1><div class="sub">${escape(sub)}</div></div>${end ? `<div class="end">${end}</div>` : ''}</div>`
}

function rangeControl() {
  return `<div class="seg" role="group" aria-label="Range"><span class="hl"></span>${RANGES.map(
    r =>
      `<button type="button" data-range="${r}" aria-pressed="${r === state.days}">${r} days</button>`,
  ).join('')}</div>`
}

function card(title, aside, body) {
  return `<div class="card"><div class="card-head"><h3>${escape(title)}</h3>${aside}</div>${body}</div>`
}

function empty(words) {
  return `<p class="empty">${escape(words)}</p>`
}

function legend(entries) {
  return `<span class="legend">${entries.map(([color, label, line]) => `<span><i class="${line ? 'line' : ''}" style="background:${color}"></i>${escape(label)}</span>`).join('')}</span>`
}

/** Inside a card: a line and the button, where a whole panel would crowd it. */
function signInPrompt(words) {
  if (!state.server?.doorman) return empty('This server has no doorman to ask.')
  return `<div class="prompt"><p class="aside">${escape(words)}</p><button class="btn primary" type="button" data-action="sign-in">Sign in with Google</button></div>`
}

function signInCard(why) {
  if (!state.server?.doorman)
    return `<p class="notice">This server has no doorman, so there is nothing to sign in to.</p>`
  return `<div class="panel"><div class="row"><div class="lbl"><span class="name">${escape(why)}</span><span class="hint">Use the owner’s Google account. This browser remembers it.</span></div><div class="end"><button class="btn primary" type="button" data-action="sign-in">Sign in with Google</button></div></div></div>`
}

/** The doorman's counts, summed over the window, by name. */
function doormanTotals() {
  const totals = new Map()
  for (const { counts } of state.doormanStats?.days ?? []) {
    for (const [name, count] of Object.entries(counts))
      totals.set(name, (totals.get(name) ?? 0) + count)
  }
  return totals
}

function dataView() {
  const data = state.data
  if (!data)
    return (
      head('Data', 'Totals across everyone on this server', rangeControl()) +
      empty(state.error ?? 'Loading…')
    )
  const imports = data.imports
  const days = imports.byDay.map(d => d.day)
  const done = sum(imports.byDay.map(d => d.done))
  const failed = sum(imports.byDay.map(d => d.failed))
  const total = done + failed
  const before = imports.before.done + imports.before.failed
  const change = before > 0 ? Math.round(((total - before) / before) * 100) : null
  const doorTotals = doormanTotals()
  const signedIn = state.doormanStats !== null
  const audioReads = doorTotals.get('reads.audio') ?? 0
  const plays = sum(data.plays.map(p => p.count))

  const stats = `<div class="stats">
    <div class="stat"><span class="label">Imports</span><span class="v">${fmt(total)}</span><span class="d ${change === null ? '' : change >= 0 ? 'up' : 'down'}">${change === null ? `in ${state.days} days` : `${change >= 0 ? '+' : ''}${change}% on the ${state.days} days before`}</span></div>
    <div class="stat"><span class="label">Worked</span><span class="v">${total ? `${((done / total) * 100).toFixed(1)}%` : '—'}</span><span class="d">${plural(failed, 'import', 'imports')} couldn’t import</span></div>
    <div class="stat"><span class="label">Typical time</span><span class="v">${duration(imports.medianMs)}</span><span class="d">median, start to finish</span></div>
    <div class="stat"><span class="label">Songs downloaded</span><span class="v">${signedIn ? fmt(audioReads) : '—'}</span><span class="d">${signedIn ? 'from buckets, everyone' : 'sign in to see the doorman’s counts'}</span></div>
  </div>`

  const perDay = card(
    'Imports a day',
    legend([
      ['var(--accent)', 'worked'],
      ['var(--danger)', 'failed'],
      ['var(--text-primary)', 'error rate', true],
    ]),
    total
      ? bars(
          days,
          [imports.byDay.map(d => d.done), imports.byDay.map(d => d.failed)],
          ['var(--accent)', 'var(--danger)'],
          {
            label: 'Imports a day',
            line: imports.byDay.map(d =>
              d.done + d.failed ? (100 * d.failed) / (d.done + d.failed) : 0,
            ),
            lineMax: Math.max(
              20,
              niceMax(
                Math.max(
                  ...imports.byDay.map(d =>
                    d.done + d.failed ? (100 * d.failed) / (d.done + d.failed) : 0,
                  ),
                ),
              ),
            ),
          },
        )
      : empty(`No imports in these ${state.days} days.`),
  )
  const time = card(
    'How long a song takes to import',
    `<span class="aside">${plural(done, 'song', 'songs')} · past 3 minutes in amber</span>`,
    done
      ? histogram(imports.bands, imports.medianMs, imports.p90Ms)
      : empty('Nothing imported yet to time.'),
  )
  const stepTotal = sum(imports.steps.map(s => s.medianMs))
  const steps = card(
    'Where the time goes',
    '<span class="aside">median per step</span>',
    imports.steps.length
      ? `<div class="steps anim">${imports.steps.map(s => `<i style="flex:${Math.max(s.medianMs, stepTotal * 0.01)};background:${STEPS[s.step][1]}"></i>`).join('')}</div>
         <div class="step-list">${imports.steps.map(s => `<span><i style="background:${STEPS[s.step][1]}"></i>${STEPS[s.step][0]}<b>${duration(s.medianMs)}</b></span>`).join('')}</div>`
      : empty('Nothing imported yet to time.'),
  )
  const yt = imports.youtube
  const ytTotal = sum(yt.map(d => d.done + d.failed))
  const held = sum(imports.held.map(d => d.count))
  const youtube = card(
    'YouTube downloads',
    legend([
      ['var(--accent)', 'worked, % a day', true],
      ['var(--danger)', 'YouTube held the server'],
    ]),
    ytTotal || held
      ? `${shareLine(
          days,
          yt.map(d => (d.done + d.failed ? (100 * d.done) / (d.done + d.failed) : null)),
          imports.held.map(d => d.count > 0),
        )}<div class="aside">${plural(held, 'hold', 'holds')} in ${state.days} days · ${plural(imports.retried, 'import', 'imports')} worked on a retry</div>`
      : empty(`No YouTube imports in these ${state.days} days.`),
  )
  const failures = card(
    'Why imports fail',
    `<span class="aside">${plural(failed, 'failure', 'failures')}</span>`,
    imports.failures.length
      ? hbars(
          imports.failures.map(f => ({
            label: FAILURES[f.kind] ?? f.kind,
            value: f.count,
            shown: `${Math.round((100 * f.count) / failed)}%`,
          })),
          { tone: 'bad', labelWidth: '58%' },
        )
      : empty('Nothing failed.'),
  )
  const sources = card(
    'By source',
    '<span class="aside">share · worked · median</span>',
    imports.sources.length
      ? `<div class="table"><div class="tr head"><span>Source</span><span class="num">Share</span><span>Worked</span><span class="num">Median</span></div>${imports.sources
          .map(s => {
            const all = s.done + s.failed
            const ok = all ? (100 * s.done) / all : 0
            return `<div class="tr"><span>${escape(SOURCES[s.source] ?? s.source)}</span><span class="num">${Math.round((100 * all) / total)}%</span><span class="hbar" style="grid-template-columns:minmax(0,1fr) 52px"><span class="b"><i class="${ok < 95 ? 'warn' : ''}" style="width:${ok}%"></i></span><span class="n">${ok.toFixed(1)}%</span></span><span class="num">${duration(s.medianMs)}</span></div>`
          })
          .join('')}</div>`
      : empty(`No imports in these ${state.days} days.`),
  )

  const readDays = days.map(day => state.doormanStats?.days.find(d => d.day === day)?.counts ?? {})
  const downloads = card(
    'Downloads from buckets',
    signedIn
      ? legend([
          ['var(--accent)', 'songs'],
          ['var(--accent-dim)', 'covers'],
          ['var(--text-muted)', 'lyrics'],
        ])
      : '',
    signedIn
      ? bars(
          days,
          [
            readDays.map(c => c['reads.audio'] ?? 0),
            readDays.map(c => c['reads.covers'] ?? 0),
            readDays.map(c => c['reads.lyrics'] ?? 0),
          ],
          ['var(--accent)', 'var(--accent-dim)', 'var(--text-muted)'],
          { label: 'Reads from buckets a day' },
        )
      : signInPrompt(
          'The doorman counts every read from a bucket. Sign in as the owner to see them.',
        ),
  )
  const byApp = Object.entries(READ_APPS)
    .map(([key, label]) => ({ label, value: doorTotals.get(`reads.by.${key}`) ?? 0 }))
    .filter(r => r.value > 0)
  const readsByApp = signedIn
    ? card(
        'Reads by app',
        `<span class="aside">${plays ? `${(audioReads / plays).toFixed(1)} song reads per play` : 'no plays to compare'}</span>`,
        byApp.length ? hbars(byApp) : empty('Nothing read in these days.'),
      )
    : ''
  const playsCard = card(
    'Plays',
    `<span class="aside">${plural(plays, 'play', 'plays')}, every library</span>`,
    plays
      ? bars(days, [data.plays.map(p => p.count)], ['var(--accent)'], {
          label: 'Plays a day',
          W: 420,
        })
      : empty('No plays yet.'),
  )

  const usage = card(
    'Features used',
    `<span class="aside">times, everyone, ${state.days} days</span>`,
    data.usage.length
      ? hbars(
          data.usage
            .map(u => ({ label: FEATURES[u.feature] ?? u.feature, value: u.count }))
            .sort((a, b) => b.value - a.value),
        )
      : empty('No app has reported yet. Apps send their counts once a day.'),
  )
  const smartCount = sum(data.smart.byFeature.map(f => f.count))
  const smart = card(
    'Smart features',
    '<span class="aside">requests</span>',
    smartCount
      ? `${hbars(data.smart.byFeature.map(f => ({ label: SMART[f.feature] ?? f.feature, value: f.count })))}<div class="aside">${smartCount ? ((100 * data.smart.failed) / smartCount).toFixed(1) : 0}% failed · ${duration(data.smart.averageMs)} on average</div>`
      : empty('No Smart requests in these days.'),
  )
  const errorCount = sum(data.errors.map(e => e.count))
  const errors = card(
    'Errors',
    `<span class="pill ${errorCount ? 'bad' : 'good'}">${errorCount ? `${fmt(errorCount)} in ${state.days} days` : 'none'}</span>`,
    data.errors.length
      ? `<div class="panel" style="box-shadow:none;padding:0">${data.errors
          .map(
            e =>
              `<div class="row" style="min-height:0;padding:8px 0"><div class="lbl"><span class="name ${e.from === 'server' ? 'mono' : ''}">${escape(e.from === 'server' ? e.name : (APP_ERRORS[e.name] ?? e.name))}</span></div><span class="aside">${fmt(e.count)} · last ${shortDay(e.lastDay)}</span></div>`,
          )
          .join('')}</div>`
      : empty('Nothing went wrong.'),
  )

  return `${head('Data', 'Totals across everyone on this server', rangeControl())}
    ${state.error ? `<p class="notice bad">${escape(state.error)}</p>` : ''}
    ${stats}
    <section class="section"><div class="section-head"><h2 class="section-title">Music import</h2><span class="aside">${shortDay(data.from)} – ${shortDay(data.to)}</span></div>
      ${perDay}
      <div class="grid2">${time}${steps}</div>
      <div class="grid2">${youtube}${failures}</div>
      ${sources}
    </section>
    <section class="section"><div class="section-head"><h2 class="section-title">Listening</h2></div>${downloads}<div class="grid2">${readsByApp}${playsCard}</div></section>
    <section class="section"><div class="section-head"><h2 class="section-title">The app</h2></div><div class="grid2">${usage}${smart}</div>${errors}</section>`
}

function accessView() {
  const header = head('Access', 'Who can sign in to self.mp3')
  if (!state.server) return header + empty(state.error ?? 'Loading…')
  if (state.doormanProblem)
    return `${header}<p class="notice bad">${escape(state.doormanProblem)}</p>${signInCard('Sign in again')}`
  if (!session() || !state.access) return header + signInCard('Sign in to change who can sign in')
  const access = state.access
  const requests = state.requests ?? []
  const asking = requests.length
    ? `<div class="panel">${requests
        .map(
          r =>
            `<div class="row"><div class="lbl"><span class="name">${escape(r.email)}</span><span class="hint">Tried ${plural(r.tries, 'time', 'times')} · last ${escape(relative(r.lastAt))} · not on the list</span></div><div class="end"><button class="btn primary" type="button" data-action="let-in" data-email="${escape(r.email)}">Let in</button><button class="btn" type="button" data-action="dismiss" data-email="${escape(r.email)}">Dismiss</button></div></div>`,
        )
        .join('')}</div>`
    : empty('Nobody has been turned away this week.')
  return `${header}
    ${state.error ? `<p class="notice bad">${escape(state.error)}</p>` : ''}
    <section class="section"><div class="section-head"><span class="label">Asked to get in</span><span class="aside">kept 7 days</span></div>${asking}</section>
    <section class="section"><div class="section-head"><span class="label">Who can sign in</span></div>
      <div class="panel">
        <div class="row"><div class="lbl"><span class="name">Anyone with a Google account</span><span class="hint">${access.anyone ? 'On: anyone who signs in with Google gets in.' : 'Off: only you and the people below.'}</span></div><input class="switch" type="checkbox" role="switch" aria-label="Anyone with a Google account" data-action="anyone" ${access.anyone ? 'checked' : ''} ${state.busy ? 'disabled' : ''} /></div>
        ${access.owners.map(owner => `<div class="row"><div class="lbl"><span class="name">${escape(owner)}</span><span class="hint">Owner · always let in</span></div></div>`).join('')}
        ${access.emails.map(email => `<div class="row"><div class="lbl"><span class="name">${escape(email)}</span></div><div class="end"><button class="btn danger" type="button" data-action="remove" data-email="${escape(email)}" ${state.busy ? 'disabled' : ''}>Remove</button></div></div>`).join('')}
        <form class="row" data-action="add"><div class="lbl"><span class="name">Add someone</span><span class="hint">Their Google address. While Google sign-in is in Testing, add them as a test user there too.</span></div><div class="end"><input class="field" type="email" name="email" placeholder="name@gmail.com" autocomplete="off" aria-label="Google address to let in" required /><button class="btn primary" type="submit" ${state.busy ? 'disabled' : ''}>Add</button></div></form>
      </div>
    </section>`
}

function serverView() {
  const s = state.server
  const header = head('Server', 'This self.mp3 server')
  if (!s) return header + empty(state.error ?? 'Loading…')
  const uptime =
    s.uptimeSeconds < 3600
      ? `${Math.round(s.uptimeSeconds / 60)} min`
      : s.uptimeSeconds < 172_800
        ? `${Math.round(s.uptimeSeconds / 3600)} h`
        : `${Math.round(s.uptimeSeconds / 86_400)} days`
  const smartWords = {
    answering: ['answering', 'good'],
    'not-answering': ['not answering', 'bad'],
    off: ['off', ''],
  }[s.smart]
  const youtubeHeld = s.youtube.heldUntil !== null
  return `${header}
    ${state.error ? `<p class="notice bad">${escape(state.error)}</p>` : ''}
    <div class="stats">
      <div class="stat"><span class="label">Up for</span><span class="v">${uptime}</span><span class="d">version ${escape(s.version)}</span></div>
      <div class="stat"><span class="label">Libraries</span><span class="v">${fmt(s.libraries)}</span><span class="d">a count only</span></div>
      <div class="stat"><span class="label">Disk free</span><span class="v">${s.disk ? bytes(s.disk.freeBytes) : '—'}</span><span class="d">${s.disk ? `of ${bytes(s.disk.totalBytes)}` : 'not known here'}</span></div>
      <div class="stat"><span class="label">Memory</span><span class="v">${bytes(s.memory.usedBytes)}</span><span class="d">used of ${bytes(s.memory.totalBytes)}</span></div>
    </div>
    <div class="panel">
      <div class="row"><div class="lbl"><span class="name">Smart features</span><span class="hint">The model the server asks for Ask, tidy and picks.</span></div><span class="pill ${smartWords[1]}">${smartWords[0]}</span></div>
      <div class="row"><div class="lbl"><span class="name">YouTube</span><span class="hint">${youtubeHeld ? `Holding off until ${new Date(s.youtube.heldUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : s.youtube.lastHeldAt ? `Last asked to slow down ${relative(s.youtube.lastHeldAt)}` : 'Never asked to slow down'}</span></div><span class="pill ${youtubeHeld ? 'warn' : 'good'}">${youtubeHeld ? 'held' : 'open'}</span></div>
      <div class="row"><div class="lbl"><span class="name">Doorman</span><span class="hint">${s.doorman ? escape(s.doorman.url) : 'None: this server is not signed in through one.'}</span></div>${session() ? '<button class="btn" type="button" data-action="sign-out">Sign out of the doorman</button>' : ''}</div>
    </div>`
}

// ---------- Drawing ----------

function render({ entering = false } = {}) {
  for (const link of document.querySelectorAll('.nav a')) {
    if (link.dataset.tab === state.tab) link.setAttribute('aria-current', 'page')
    else link.removeAttribute('aria-current')
  }
  const waiting = state.requests?.length ?? 0
  document.getElementById('access-count').textContent = waiting > 0 ? String(waiting) : ''
  const who = document.getElementById('who')
  who.innerHTML = session()
    ? `<span>Signed in to the doorman</span>`
    : state.server?.doorman
      ? `<button class="btn text" type="button" data-action="sign-in">Sign in to the doorman</button>`
      : ''

  const page = document.getElementById('page')
  const view =
    state.tab === 'data' ? dataView() : state.tab === 'access' ? accessView() : serverView()
  page.innerHTML = `<div class="view${entering ? ' entering' : ''}">${view}</div>`
  placeHighlight()
  document.title = `${state.tab[0].toUpperCase()}${state.tab.slice(1)} · self.mp3 admin`
}

/** The segmented control's pill under the range picked: it slides when a range is picked, and is simply there after a redraw. */
function placeHighlight({ slide = false } = {}) {
  const seg = document.querySelector('.seg')
  if (!seg) return
  const on = seg.querySelector('button[aria-pressed="true"]')
  const hl = seg.querySelector('.hl')
  if (!on || !hl) return
  if (!slide) hl.style.transition = 'none'
  hl.style.width = `${on.offsetWidth}px`
  hl.style.transform = `translateX(${on.offsetLeft}px)`
  if (!slide) {
    void hl.offsetWidth
    hl.style.transition = ''
  }
}

// ---------- Acting ----------

async function changeAccess(change) {
  const paths = state.server?.doorman?.paths
  if (!paths || !state.access || state.busy) return
  const next = change({ anyone: state.access.anyone, emails: [...state.access.emails] })
  state.busy = true
  state.error = null
  render()
  try {
    const saved = await doorman(paths.access, { method: 'PUT', body: JSON.stringify(next) })
    if (saved) state.access = saved
    const requests = await doorman(paths.accessRequests)
    state.requests = requests?.requests ?? state.requests
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error)
  } finally {
    state.busy = false
    render()
  }
}

async function go(tab, { push = true } = {}) {
  state.tab = tab
  if (push) history.pushState(null, '', `/${tab}`)
  render({ entering: true })
  await load()
  render()
}

document.addEventListener('click', event => {
  const target = event.target instanceof Element ? event.target : null
  const link = target?.closest('.nav a')
  if (link && !event.metaKey && !event.ctrlKey) {
    event.preventDefault()
    void go(link.dataset.tab)
    return
  }
  const range = target?.closest('button[data-range]')
  if (range) {
    state.days = Number(range.dataset.range)
    try {
      localStorage.setItem(RANGE_KEY, String(state.days))
    } catch {
      // Remembered for this visit only.
    }
    for (const button of range.parentElement.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button === range))
    }
    placeHighlight({ slide: true })
    // Drawn again once the slide is over, so the new numbers do not cut it short.
    void Promise.all([load(), new Promise(resolve => setTimeout(resolve, 220))]).then(() =>
      render(),
    )
    return
  }
  const action = target?.closest('[data-action]')
  if (!action || action.tagName === 'FORM' || action.tagName === 'INPUT') return
  const email = action.getAttribute('data-email')
  switch (action.getAttribute('data-action')) {
    case 'sign-in':
      void signIn().catch(error => {
        state.error = error.message
        render()
      })
      break
    case 'sign-out':
      void signOut()
      break
    case 'let-in':
      void changeAccess(list => ({ ...list, emails: [...list.emails, email] }))
      break
    case 'remove':
      void changeAccess(list => ({ ...list, emails: list.emails.filter(e => e !== email) }))
      break
    case 'dismiss': {
      const paths = state.server?.doorman?.paths
      if (!paths) break
      void doorman(`${paths.accessRequests}?email=${encodeURIComponent(email)}`, {
        method: 'DELETE',
      })
        .then(() => loadAccess())
        .then(() => render())
      break
    }
  }
})

document.addEventListener('change', event => {
  const input = event.target
  if (input instanceof HTMLInputElement && input.dataset.action === 'anyone') {
    void changeAccess(list => ({ ...list, anyone: input.checked }))
  }
})

document.addEventListener('submit', event => {
  const form = event.target
  if (!(form instanceof HTMLFormElement) || form.dataset.action !== 'add') return
  event.preventDefault()
  const email = String(new FormData(form).get('email') ?? '')
    .trim()
    .toLowerCase()
  if (!email) return
  void changeAccess(list => ({ ...list, emails: [...list.emails, email] }))
})

window.addEventListener('popstate', () => void go(tabOf(location.pathname), { push: false }))
window.addEventListener('resize', () => placeHighlight())

// A page left open keeps itself current, while it is being looked at.
setInterval(() => {
  if (document.visibilityState === 'visible' && !state.busy) void load().then(() => render())
}, REFRESH_MS)

async function start() {
  if (location.pathname === '/') history.replaceState(null, '', '/data')
  render()
  try {
    state.server = await ask('/api/admin/server')
    await claimSignIn()
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error)
  }
  render()
  await load()
  // The Access count in the sidebar, whichever tab is open.
  if (state.tab !== 'access' && session()) await loadAccess().catch(() => undefined)
  render()
}

void start()
