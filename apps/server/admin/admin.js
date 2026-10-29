/*
 * The owner's admin page (docs/features/admin.md): Data and People.
 *
 * Plain browser JavaScript with no build step. Everything is asked of this
 * page's own address (`/api/admin/*`); the server asks the doorman for what
 * it keeps, with its admin key, so nothing here signs in.
 *
 * The frame is the app's; the charts are working charts in its colours: one
 * axis each, drawn at the size they are shown, a tooltip on every mark and a
 * table behind every chart.
 */

const RANGE_KEY = 'selfmp3-admin-range'
const TABS = ['data', 'people', 'iphones']
const RANGES = [
  [7, 'Week'],
  [30, 'Month'],
  [90, '3 months'],
]
const REFRESH_MS = 60_000
/**
 * How long an address just added can take to be let in everywhere: the doorman
 * keeps its list in Cloudflare KV, which takes up to a minute to reach its
 * other copies (apps/doorman/src/access.ts).
 */
const SETTLE_MS = 60_000

const state = {
  tab: tabOf(location.pathname),
  days: readRange(),
  data: null,
  dataError: null,
  people: null,
  peopleError: null,
  /** Addresses this page added, and when, until the doorman has them everywhere. */
  added: new Map(),
  /** Friends' iPhones, asked for on the install page (the doorman's /v1/iphones). */
  iphones: null,
  iphonesError: null,
  search: '',
  busy: false,
  confirm: null,
  /** Charts shown as their table, by id. */
  tables: new Set(),
}

// ---------- Small helpers ----------

function tabOf(pathname) {
  const name = pathname.replace(/^\/+|\/+$/g, '')
  return TABS.includes(name) ? name : 'data'
}

function readRange() {
  try {
    const saved = Number(localStorage.getItem(RANGE_KEY))
    return RANGES.some(([days]) => days === saved) ? saved : 30
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

const sum = list => list.reduce((total, n) => total + n, 0)
const fmt = n => Math.round(n).toLocaleString('en-US')

function compact(n) {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`
  return Number.isInteger(n) ? fmt(n) : n.toFixed(1)
}

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

function percent(part, whole) {
  return whole ? `${((100 * part) / whole).toFixed(part === whole ? 0 : 1)}%` : '—'
}

function day(dayText, long = false) {
  return new Date(`${dayText}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(long ? { weekday: 'short' } : {}),
    timeZone: 'UTC',
  })
}

function niceMax(v) {
  if (v <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(v))
  for (const step of [1, 2, 2.5, 5, 10]) if (v <= step * magnitude) return step * magnitude
  return 10 * magnitude
}

// ---------- Talking to the server ----------

async function ask(path, init) {
  const response = await fetch(path, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
    },
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error ?? `The server answered ${response.status}.`)
  return body
}

async function loadData() {
  try {
    state.data = await ask(`/api/admin/data?days=${state.days}`)
    state.dataError = null
  } catch (error) {
    state.dataError = error.message
  }
}

async function loadIphones() {
  try {
    state.iphones = (await ask('/api/admin/iphones')).iphones
    state.iphonesError = null
  } catch (error) {
    state.iphonesError = error.message
  }
}

async function loadPeople() {
  try {
    state.people = await ask('/api/admin/people')
    state.peopleError = null
  } catch (error) {
    state.peopleError = error.message
  }
}

// ---------- Tooltip ----------

const tooltip = document.getElementById('tooltip')

/** `rows`: [{ color, value, label }], built with textContent: names come from data. */
function showTip(event, title, rows) {
  tooltip.replaceChildren()
  const when = document.createElement('div')
  when.className = 'when'
  when.textContent = title
  tooltip.append(when)
  for (const row of rows) {
    const line = document.createElement('div')
    line.className = 'tr'
    if (row.color) {
      const key = document.createElement('i')
      key.style.background = row.color
      line.append(key)
    }
    const value = document.createElement('b')
    value.textContent = row.value
    const label = document.createElement('span')
    label.textContent = row.label
    line.append(value, label)
    tooltip.append(line)
  }
  tooltip.hidden = false
  const box = tooltip.getBoundingClientRect()
  const anchor = event.target?.getBoundingClientRect?.()
  const x = event.clientX ?? anchor?.left ?? 0
  const y = event.clientY ?? anchor?.top ?? 0
  const left = Math.min(window.innerWidth - box.width - 8, Math.max(8, x + 14))
  const top = y - box.height - 12 < 8 ? y + 16 : y - box.height - 12
  tooltip.style.left = `${left}px`
  tooltip.style.top = `${top}px`
}

function hideTip() {
  tooltip.hidden = true
}

// ---------- Charts ----------

const SVG = 'http://www.w3.org/2000/svg'
const charts = new Map()

/** One chart's card: a title, a legend, the plot drawn at its own width, and a table view. */
function chartCard({ id, title, subtitle = '', legend = [], height = 180, draw, table }) {
  charts.set(id, { draw, height })
  const showingTable = state.tables.has(id)
  const legendHtml = legend.length
    ? `<div class="legend">${legend
        .map(
          ([color, name, line]) =>
            `<span><i class="${line ? 'line' : ''}" style="background:${color}"></i>${escape(name)}</span>`,
        )
        .join('')}</div>`
    : ''
  const tableHtml = table
    ? `<div class="table-scroll"><table class="data"><thead><tr>${table.columns
        .map((c, i) => `<th class="${i > 0 ? 'num' : ''}">${escape(c)}</th>`)
        .join('')}</tr></thead><tbody>${table.rows
        .map(
          r =>
            `<tr>${r.map((cell, i) => `<td class="${i > 0 ? 'num' : ''}">${escape(cell)}</td>`).join('')}</tr>`,
        )
        .join('')}</tbody></table></div>`
    : ''
  const toggle = table
    ? `<button class="btn small" type="button" data-table="${id}" aria-pressed="${showingTable}">${showingTable ? 'Chart' : 'Table'}</button>`
    : ''
  const titles = `<div class="titles"><h3>${escape(title)}</h3>${subtitle ? `<span class="hint">${escape(subtitle)}</span>` : ''}</div>`
  const body = showingTable
    ? tableHtml
    : `${legendHtml}<div class="plot" data-chart="${id}" style="height:${height}px"></div>`
  return `<div class="card" id="chart-${id}"><div class="card-head">${titles}${toggle}</div>${body}</div>`
}

function drawCharts() {
  for (const plot of document.querySelectorAll('.plot[data-chart]')) {
    const chart = charts.get(plot.dataset.chart)
    const width = Math.floor(plot.clientWidth)
    if (!chart || width < 40) continue
    if (plot.dataset.width === String(width)) continue
    plot.dataset.width = String(width)
    plot.replaceChildren()
    chart.draw(plot, width, chart.height)
  }
}

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(SVG, name)
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value))
  if (parent) parent.append(node)
  return node
}

function svgFor(plot, width, height) {
  return el('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img' }, plot)
}

/** A column with a 4px rounded top and a square base. */
function columnPath(x, y, w, h, roundTop) {
  if (h <= 0) return ''
  const r = roundTop ? Math.min(4, w / 2, h) : 0
  const topLeft = r ? `Q${x},${y} ${x + r},${y}` : ''
  const topRight = r ? `Q${x + w},${y} ${x + w},${y + r}` : ''
  return `M${x},${y + h}V${y + r}${topLeft}H${x + w - r}${topRight}V${y + h}Z`
}

/** Y ticks: 0, the middle and the top, on clean numbers. */
function yAxis(svg, { left, right, y, max, format = compact }) {
  for (const t of [0, max / 2, max]) {
    el('line', { class: 'tick-line', x1: left, x2: right, y1: y(t), y2: y(t) }, svg)
    el('text', { x: left - 8, y: y(t) + 4, 'text-anchor': 'end' }, svg).textContent = format(t)
  }
}

/** Day labels under a time axis, as many as fit without touching. */
function dayLabels(svg, days, xOf, bottom) {
  const room = days.length > 1 ? Math.abs(xOf(1) - xOf(0)) : 999
  const every = Math.max(1, Math.ceil(48 / room))
  days.forEach((d, i) => {
    if ((days.length - 1 - i) % every !== 0) return
    el('text', { x: xOf(i), y: bottom, 'text-anchor': 'middle' }, svg).textContent = day(d)
  })
}

/**
 * Columns, stacked when there is more than one series, one per day (or per
 * band). Each column is its own hover target, with every series in its tooltip.
 */
function columns({
  labels,
  series,
  tipTitle,
  tipExtra = () => [],
  labelsAre = 'days',
  markers = [],
}) {
  return (plot, width, height) => {
    const svg = svgFor(plot, width, height)
    const left = 40
    const bottom = height - 22
    const top = markers.length ? 22 : 6
    const totals = labels.map((_, i) => sum(series.map(s => s.values[i] ?? 0)))
    // Counts: at least 0, 2, 4 on the axis, so a quiet week is not drawn as 0, 0.5, 1.
    const max = niceMax(Math.max(...totals, 4))
    const y = v => top + (bottom - top) * (1 - v / max)
    const band = (width - left) / labels.length
    const barW = Math.min(24, Math.max(2, band * 0.7))
    const xOf = i => left + band * i + band / 2
    yAxis(svg, { left, right: width, y, max })
    const groups = []
    labels.forEach((_, i) => {
      const g = el('g', { class: 'bar' }, svg)
      let base = 0
      series.forEach((s, si) => {
        const v = s.values[i] ?? 0
        if (v <= 0) return
        const y0 = y(base + v)
        // The 2px surface gap between stacked segments.
        const h = y(base) - y0 - (base > 0 ? 2 : 0)
        const isTop = series.slice(si + 1).every(next => (next.values[i] ?? 0) <= 0)
        el(
          'path',
          { d: columnPath(xOf(i) - barW / 2, y0, barW, Math.max(h, 1), isTop), fill: s.color },
          g,
        )
        base += v
      })
      groups.push(g)
      const hit = el(
        'rect',
        {
          class: 'hit',
          x: left + band * i,
          y: top,
          width: band,
          height: bottom - top,
          tabindex: 0,
        },
        svg,
      )
      const tip = event => {
        plot.classList.add('hovering')
        groups.forEach((other, j) => other.classList.toggle('dim', j !== i))
        showTip(event, tipTitle(i), [
          ...series.map(s => ({
            color: s.color,
            value: s.format ? s.format(s.values[i] ?? 0) : fmt(s.values[i] ?? 0),
            label: s.name,
          })),
          ...tipExtra(i),
        ])
      }
      const untip = () => {
        plot.classList.remove('hovering')
        groups.forEach(other => other.classList.remove('dim'))
        hideTip()
      }
      hit.addEventListener('pointermove', tip)
      hit.addEventListener('focus', tip)
      hit.addEventListener('pointerleave', untip)
      hit.addEventListener('blur', untip)
    })
    if (labelsAre === 'days') dayLabels(svg, labels, xOf, height - 4)
    else {
      labels.forEach((label, i) => {
        el('text', { x: xOf(i), y: height - 4, 'text-anchor': 'middle' }, svg).textContent = label
      })
    }
    for (const marker of markers) {
      const x = left + band * marker.at
      el('line', { class: 'marker', x1: x, x2: x, y1: 4, y2: bottom }, svg)
      el('text', { class: 'marker-label', x: x + 4, y: 14 }, svg).textContent = marker.label
    }
  }
}

/**
 * One series over days, with a crosshair that snaps to the nearest day and a
 * tooltip. Days with no value leave a gap. `marks` puts a warning line on days.
 */
function line({ days, values, color, name, format, max: fixedMax, marks = [], markName = '' }) {
  return (plot, width, height) => {
    const svg = svgFor(plot, width, height)
    const left = 44
    const right = width - 6
    const bottom = height - 22
    const top = 10
    const present = values.filter(v => v !== null)
    const max = fixedMax ?? niceMax(Math.max(...present, 1))
    const y = v => top + (bottom - top) * (1 - v / max)
    const xOf = i =>
      days.length > 1 ? left + ((right - left) * i) / (days.length - 1) : (left + right) / 2
    yAxis(svg, { left, right, y, max, format: format.axis })
    // Runs of days with a value, each one stroke, with a faint wash under.
    let run = []
    const runs = []
    values.forEach((v, i) => {
      if (v === null) {
        if (run.length) runs.push(run)
        run = []
      } else run.push([xOf(i), y(v)])
    })
    if (run.length) runs.push(run)
    for (const points of runs) {
      if (points.length > 1) {
        const path = points.map(([x, py], i) => `${i ? 'L' : 'M'}${x},${py}`).join('')
        const wash = `${path}L${points.at(-1)[0]},${bottom}L${points[0][0]},${bottom}Z`
        el('path', { d: wash, fill: color, 'fill-opacity': 0.1 }, svg)
        el(
          'path',
          {
            d: path,
            fill: 'none',
            stroke: color,
            'stroke-width': 2,
            'stroke-linejoin': 'round',
            'stroke-linecap': 'round',
          },
          svg,
        )
      } else {
        el('circle', { cx: points[0][0], cy: points[0][1], r: 3, fill: color }, svg)
      }
    }
    marks.forEach((on, i) => {
      if (!on) return
      el(
        'line',
        {
          x1: xOf(i),
          x2: xOf(i),
          y1: top,
          y2: bottom,
          stroke: 'var(--warning)',
          'stroke-width': 1.5,
          'stroke-dasharray': '3 3',
        },
        svg,
      )
    })
    const lastIndex = values.findLastIndex(v => v !== null)
    if (lastIndex >= 0) {
      el(
        'circle',
        {
          cx: xOf(lastIndex),
          cy: y(values[lastIndex]),
          r: 4,
          fill: color,
          stroke: 'var(--surface1)',
          'stroke-width': 2,
        },
        svg,
      )
    }
    dayLabels(svg, days, xOf, height - 4)
    const cross = el(
      'line',
      { class: 'crosshair', x1: 0, x2: 0, y1: top, y2: bottom, visibility: 'hidden' },
      svg,
    )
    const dot = el(
      'circle',
      { r: 4, fill: color, stroke: 'var(--surface1)', 'stroke-width': 2, visibility: 'hidden' },
      svg,
    )
    const hit = el(
      'rect',
      { class: 'hit', x: left, y: top, width: right - left, height: bottom - top, tabindex: 0 },
      svg,
    )
    let focused = lastIndex >= 0 ? lastIndex : 0
    const at = (i, event) => {
      focused = i
      const x = xOf(i)
      cross.setAttribute('x1', x)
      cross.setAttribute('x2', x)
      cross.setAttribute('visibility', 'visible')
      const v = values[i]
      if (v !== null) {
        dot.setAttribute('cx', x)
        dot.setAttribute('cy', y(v))
        dot.setAttribute('visibility', 'visible')
      } else dot.setAttribute('visibility', 'hidden')
      showTip(event, day(days[i], true), [
        {
          color,
          value: v === null ? 'none that day' : format.value(v),
          label: v === null ? '' : name,
        },
        ...(marks[i] ? [{ color: 'var(--warning)', value: 'held', label: markName }] : []),
      ])
    }
    const pointAt = i => {
      const box = hit.getBoundingClientRect()
      return {
        clientX: box.left + ((xOf(i) - left) / (right - left)) * box.width,
        clientY: box.top,
      }
    }
    hit.addEventListener('pointermove', event => {
      const box = hit.getBoundingClientRect()
      const ratio = (event.clientX - box.left) / box.width
      at(Math.round(ratio * (days.length - 1)), event)
    })
    hit.addEventListener('keydown', event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      const step = event.key === 'ArrowRight' ? 1 : -1
      const next = Math.min(days.length - 1, Math.max(0, focused + step))
      at(next, pointAt(next))
    })
    hit.addEventListener('focus', () => at(focused, pointAt(focused)))
    const leave = () => {
      cross.setAttribute('visibility', 'hidden')
      dot.setAttribute('visibility', 'hidden')
      hideTip()
    }
    hit.addEventListener('pointerleave', leave)
    hit.addEventListener('blur', leave)
  }
}

/** Horizontal bars for ranked categories: names left, the value at the bar's tip. */
function hbars(rows, { color = 'var(--accent)', format = fmt } = {}) {
  if (!rows.length) return '<p class="empty">Nothing yet.</p>'
  const max = Math.max(...rows.map(r => r.value), 1)
  return `<div class="hbars">${rows
    .map(
      r =>
        `<div class="hbar-row"><span class="hbar-name" title="${escape(r.label)}">${escape(r.label)}</span><span class="hbar-track"><i style="width:${Math.max(1, (100 * r.value) / max)}%;background:${color}"></i></span><span class="hbar-value">${escape(format(r.value))}</span></div>`,
    )
    .join('')}</div>`
}

// ---------- Words ----------

const FAILURES = {
  'youtube-blocked': 'YouTube asked the server to slow down',
  unavailable: 'Video unavailable, private or age-restricted',
  'no-match': 'No match found',
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
  waiting: 'Waiting in line',
  resolving: 'Finding the song',
  downloading: 'Downloading',
  converting: 'Converting',
  lyrics: 'Lyrics',
  saving: 'Saving',
  uploading: 'Uploading to the bucket',
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
  'cloud-unreachable': 'Showed “Can’t reach your library”',
  'server-away': 'Showed the server as away',
  'bucket-full': 'Showed the bucket as full for the day',
}
const READ_APPS = {
  web: 'Web',
  computer: 'Computer',
  phone: 'Phone',
  extension: 'Extension',
  server: 'Server',
  lent: 'Lent to rooms and links',
}
const BANDS = ['< 30 s', '30 s–1 m', '1–2 m', '2–3 m', '3–5 m', '5–10 m', '10 m +']
const BAND_LIMITS = [30_000, 60_000, 120_000, 180_000, 300_000, 600_000]

// ---------- Views ----------

function head(title, sub, end = '') {
  const tail = end ? `<div class="end">${end}</div>` : ''
  return `<div class="page-head"><div><h1 class="page-title">${escape(title)}</h1><div class="sub">${sub}</div></div>${tail}</div>`
}

function rangeControl() {
  const buttons = RANGES.map(
    ([days, name]) =>
      `<button type="button" data-range="${days}" aria-pressed="${days === state.days}">${name}</button>`,
  )
  return `<div class="seg" role="group" aria-label="Range">${buttons.join('')}</div>`
}

function statTile(name, value, delta = '', tone = '') {
  return `<div class="stat"><span class="k">${escape(name)}</span><span class="v">${escape(value)}</span><span class="d ${tone}">${escape(delta)}</span></div>`
}

function deltaOf(now, before) {
  if (!before) return ['', '']
  const change = Math.round((100 * (now - before)) / before)
  return [
    `${change >= 0 ? '+' : ''}${change}% on the ${state.days} days before`,
    change >= 0 ? 'up' : 'down',
  ]
}

/** Where a time falls on the band axis, in bands from the left. */
function bandPosition(ms) {
  const band = BAND_LIMITS.findIndex(limit => ms < limit)
  const i = band === -1 ? BAND_LIMITS.length : band
  const low = i === 0 ? 0 : BAND_LIMITS[i - 1]
  const high = BAND_LIMITS[i] ?? low * 2
  return i + Math.min(1, (ms - low) / (high - low))
}

function listCard(title, hint, body, id = '') {
  return `<div class="card"${id ? ` id="chart-${id}"` : ''}><div class="card-head"><div class="titles"><h3>${escape(title)}</h3><span class="hint">${escape(hint)}</span></div></div>${body}</div>`
}

function statusLine(status) {
  if (!status) return 'Totals across everyone'
  const smart =
    status.smart === 'answering'
      ? '<span class="ok">answering</span>'
      : status.smart === 'off'
        ? 'off'
        : '<span class="bad">not answering</span>'
  const youtube = status.youtubeHeldUntil
    ? `<span class="warn">held until ${new Date(status.youtubeHeldUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>`
    : '<span class="ok">open</span>'
  return `Totals across everyone · Smart features ${smart} · YouTube ${youtube}`
}

/** The page's own index, as Settings has one: sections, and the cards under them. */
function indexOf(entries) {
  const items = entries
    .map(
      ([id, label, level]) =>
        `<a href="#${id}" class="${level ? 'sub' : ''}" data-index="${id}">${escape(label)}</a>`,
    )
    .join('')
  return `<nav class="index" aria-label="On this page"><span class="label">On this page</span>${items}</nav>`
}

/**
 * Lights the index entry for what is being read: the last card or section
 * whose top has passed a line a quarter down the window. Two cards side by
 * side pass it together, and the first of them is lit; an entry clicked stays
 * lit, whatever sits beside it or below it, until the reader scrolls themself.
 */
let pinned = null
function lightIndex() {
  const links = [...document.querySelectorAll('.index a')]
  if (!links.length) return
  let current = pinned
  if (!current) {
    const line = window.innerHeight / 4
    let passed = -Infinity
    for (const link of links) {
      const top = document.getElementById(link.dataset.index)?.getBoundingClientRect().top
      if (top !== undefined && top <= line && top > passed + 1) {
        passed = top
        current = link.dataset.index
      }
    }
    current ??= links[0].dataset.index
  }
  for (const link of links) {
    if (link.dataset.index === current) link.setAttribute('aria-current', 'location')
    else link.removeAttribute('aria-current')
  }
}

let indexFrame = 0
function lightIndexSoon() {
  indexFrame ||= requestAnimationFrame(() => {
    indexFrame = 0
    lightIndex()
  })
}

function dataView() {
  charts.clear()
  const data = state.data
  const header = head('Data', statusLine(data?.status), rangeControl())
  if (!data) return header + `<p class="empty">${escape(state.dataError ?? 'Loading…')}</p>`

  const imports = data.imports
  const days = imports.byDay.map(d => d.day)
  const done = sum(imports.byDay.map(d => d.done))
  const failed = sum(imports.byDay.map(d => d.failed))
  const total = done + failed
  const [importDelta, importTone] = deltaOf(total, imports.before.done + imports.before.failed)
  const plays = sum(data.plays.map(p => p.count))
  const doorDays = days.map(d => data.doorman?.days.find(x => x.day === d)?.counts ?? {})
  const doorTotal = name => sum(doorDays.map(c => c[name] ?? 0))
  const songReads = doorTotal('reads.audio')
  // The doorman's names for them (DOORMAN_COUNT in packages/shared).
  const signIns = doorTotal('signins.new')
  const turnedAway = doorTotal('signins.refused')

  const stats = `<div class="stats">
    ${statTile('Imports', fmt(total), importDelta, importTone)}
    ${statTile('Worked', percent(done, total), `${plural(failed, 'import', 'imports')} failed`)}
    ${statTile('Median import time', duration(imports.medianMs), imports.p90Ms === null ? '' : `9 in 10 under ${duration(imports.p90Ms)}`)}
    ${statTile('Plays', fmt(plays), 'every library')}
    ${statTile(
      'Songs read from buckets',
      data.doorman ? fmt(songReads) : '—',
      data.doorman
        ? plays
          ? `${(songReads / plays).toFixed(1)} per play`
          : ''
        : 'the doorman’s count',
    )}
    ${statTile(
      'Sign-ins',
      data.doorman ? fmt(signIns) : '—',
      data.doorman ? `${fmt(turnedAway)} turned away` : 'the doorman’s count',
    )}
  </div>`

  const perDay = chartCard({
    id: 'imports',
    title: 'Imports a day',
    subtitle: `${plural(total, 'import', 'imports')} · ${percent(failed, total)} failed`,
    legend: [
      ['var(--accent)', 'Worked'],
      ['var(--danger)', 'Failed'],
    ],
    height: 200,
    draw: columns({
      labels: days,
      series: [
        { name: 'worked', color: 'var(--accent)', values: imports.byDay.map(d => d.done) },
        { name: 'failed', color: 'var(--danger)', values: imports.byDay.map(d => d.failed) },
      ],
      tipTitle: i => day(days[i], true),
      tipExtra: i => {
        const d = imports.byDay[i]
        return d.done + d.failed
          ? [{ value: percent(d.failed, d.done + d.failed), label: 'failed' }]
          : []
      },
    }),
    table: {
      columns: ['Day', 'Worked', 'Failed'],
      rows: imports.byDay.map(d => [day(d.day, true), fmt(d.done), fmt(d.failed)]),
    },
  })

  const errorRate = imports.byDay.map(d =>
    d.done + d.failed ? (100 * d.failed) / (d.done + d.failed) : null,
  )
  const errorCard = chartCard({
    id: 'error-rate',
    title: 'Share that failed',
    subtitle: 'per day, of that day’s imports',
    draw: line({
      days,
      values: errorRate,
      color: 'var(--danger)',
      name: 'failed',
      max: Math.max(10, niceMax(Math.max(...errorRate.filter(v => v !== null), 0))),
      format: { axis: v => `${Math.round(v)}%`, value: v => `${v.toFixed(1)}%` },
    }),
    table: {
      columns: ['Day', 'Failed'],
      rows: imports.byDay.map((d, i) => [
        day(d.day, true),
        errorRate[i] === null ? '—' : `${errorRate[i].toFixed(1)}%`,
      ]),
    },
  })

  const medians = imports.medianByDay.map(d => (d.medianMs === null ? null : d.medianMs / 1000))
  const medianCard = chartCard({
    id: 'median-time',
    title: 'Median import time',
    subtitle: 'per day, start to finish',
    draw: line({
      days,
      values: medians,
      color: 'var(--accent)',
      name: 'median',
      format: {
        axis: v => (v >= 60 ? `${Math.round(v / 60)}m` : `${Math.round(v)}s`),
        value: v => duration(v * 1000),
      },
    }),
    table: {
      columns: ['Day', 'Median'],
      rows: imports.medianByDay.map(d => [day(d.day, true), duration(d.medianMs)]),
    },
  })

  const markers = [
    ...(imports.medianMs === null
      ? []
      : [{ at: bandPosition(imports.medianMs), label: `median ${duration(imports.medianMs)}` }]),
    ...(imports.p90Ms === null
      ? []
      : [{ at: bandPosition(imports.p90Ms), label: `90% ${duration(imports.p90Ms)}` }]),
  ]
  const histogram = chartCard({
    id: 'bands',
    title: 'How long imports take',
    subtitle: `${plural(done, 'import', 'imports')} that worked`,
    draw: columns({
      labels: BANDS,
      labelsAre: 'bands',
      series: [{ name: 'imports', color: 'var(--accent)', values: imports.bands }],
      tipTitle: i => `Took ${BANDS[i]}`,
      tipExtra: i => [{ value: percent(imports.bands[i], done), label: 'of those that worked' }],
      markers,
    }),
    table: {
      columns: ['Took', 'Imports'],
      rows: BANDS.map((b, i) => [b, fmt(imports.bands[i] ?? 0)]),
    },
  })

  const steps = listCard(
    'Where the time goes',
    'median per step, imports that worked',
    hbars(
      [...imports.steps]
        .sort((a, b) => b.medianMs - a.medianMs)
        .map(s => ({ label: STEPS[s.step] ?? s.step, value: s.medianMs })),
      { format: duration },
    ),
    'steps',
  )

  const ytWorked = imports.youtube.map(d =>
    d.done + d.failed ? (100 * d.done) / (d.done + d.failed) : null,
  )
  const heldCount = sum(imports.held.map(d => d.count))
  const youtubeCard = chartCard({
    id: 'youtube',
    title: 'YouTube downloads that worked',
    subtitle: `${plural(heldCount, 'hold', 'holds')} · ${plural(imports.retried, 'import', 'imports')} worked on a retry`,
    legend: [
      ['var(--accent)', 'Worked, % of the day', true],
      ['var(--warning)', 'YouTube held the server', true],
    ],
    draw: line({
      days,
      values: ytWorked,
      color: 'var(--accent)',
      name: 'worked',
      max: 100,
      marks: imports.held.map(d => d.count > 0),
      markName: 'YouTube held the server',
      format: { axis: v => `${Math.round(v)}%`, value: v => `${v.toFixed(1)}%` },
    }),
    table: {
      columns: ['Day', 'Worked', 'Failed', 'Holds'],
      rows: imports.youtube.map((d, i) => [
        day(d.day, true),
        fmt(d.done),
        fmt(d.failed),
        fmt(imports.held[i].count),
      ]),
    },
  })

  const failures = listCard(
    'Why imports fail',
    plural(failed, 'failure', 'failures'),
    hbars(imports.failures.map(f => ({ label: FAILURES[f.kind] ?? f.kind, value: f.count }))),
    'failures',
  )

  const sourceRows = imports.sources
    .map(s => {
      const all = s.done + s.failed
      return `<tr><td>${escape(SOURCES[s.source] ?? s.source)}</td><td class="num">${fmt(all)}</td><td class="num">${percent(all, total)}</td><td class="num">${percent(s.done, all)}</td><td class="num">${duration(s.medianMs)}</td></tr>`
    })
    .join('')
  const sources = listCard(
    'By source',
    'where the address came from',
    imports.sources.length
      ? `<table class="data"><thead><tr><th>Source</th><th class="num">Imports</th><th class="num">Share</th><th class="num">Worked</th><th class="num">Median time</th></tr></thead><tbody>${sourceRows}</tbody></table>`
      : '<p class="empty">No imports in these days.</p>',
    'sources',
  )

  const doormanNote = data.doorman
    ? ''
    : `<p class="notice">${escape(data.doormanProblem ?? 'The doorman’s counts are not here.')}</p>`
  const reads = data.doorman
    ? chartCard({
        id: 'reads',
        title: 'Reads from buckets',
        subtitle: 'every file a device read, through the doorman',
        legend: [
          ['var(--series-1)', 'Songs'],
          ['var(--series-2)', 'Covers'],
          ['var(--series-3)', 'Lyrics'],
        ],
        height: 200,
        draw: columns({
          labels: days,
          series: [
            {
              name: 'songs',
              color: 'var(--series-1)',
              values: doorDays.map(c => c['reads.audio'] ?? 0),
            },
            {
              name: 'covers',
              color: 'var(--series-2)',
              values: doorDays.map(c => c['reads.covers'] ?? 0),
            },
            {
              name: 'lyrics',
              color: 'var(--series-3)',
              values: doorDays.map(c => c['reads.lyrics'] ?? 0),
            },
          ],
          tipTitle: i => day(days[i], true),
        }),
        table: {
          columns: ['Day', 'Songs', 'Covers', 'Lyrics'],
          rows: days.map((d, i) => [
            day(d, true),
            fmt(doorDays[i]['reads.audio'] ?? 0),
            fmt(doorDays[i]['reads.covers'] ?? 0),
            fmt(doorDays[i]['reads.lyrics'] ?? 0),
          ]),
        },
      })
    : ''
  const appReads = Object.entries(READ_APPS)
    .map(([key, label]) => ({ label, value: doorTotal(`reads.by.${key}`) }))
    .filter(r => r.value > 0)
    .sort((a, b) => b.value - a.value)
  const byApp = data.doorman
    ? listCard(
        'Reads by app',
        `${fmt(sum(appReads.map(r => r.value)))} reads`,
        hbars(appReads),
        'reads-by-app',
      )
    : ''
  const playsCard = !plays
    ? listCard(
        'Plays a day',
        'every library',
        '<p class="empty">No plays in these days.</p>',
        'plays',
      )
    : chartCard({
        id: 'plays',
        title: 'Plays a day',
        subtitle: `${plural(plays, 'play', 'plays')}, every library`,
        draw: columns({
          labels: days,
          series: [{ name: 'plays', color: 'var(--accent)', values: data.plays.map(p => p.count) }],
          tipTitle: i => day(days[i], true),
        }),
        table: {
          columns: ['Day', 'Plays'],
          rows: data.plays.map(p => [day(p.day, true), fmt(p.count)]),
        },
      })

  const smartCount = sum(data.smart.byFeature.map(f => f.count))
  const usage = listCard(
    'Features used',
    'times, from apps that count them',
    data.usage.length
      ? hbars(
          data.usage
            .map(u => ({ label: FEATURES[u.feature] ?? u.feature, value: u.count }))
            .sort((a, b) => b.value - a.value),
        )
      : '<p class="empty">No app has reported yet. Apps send each day’s counts the next day.</p>',
    'features',
  )
  const smartCard = listCard(
    'Smart features',
    smartCount
      ? `${plural(smartCount, 'request', 'requests')} · ${percent(data.smart.failed, smartCount)} failed · ${duration(data.smart.averageMs)} on average`
      : 'requests',
    smartCount
      ? hbars(
          data.smart.byFeature.map(f => ({ label: SMART[f.feature] ?? f.feature, value: f.count })),
        )
      : '<p class="empty">No Smart requests in these days.</p>',
    'smart',
  )
  const errorRows = data.errors
    .map(
      e =>
        `<tr><td>${e.from === 'server' ? 'Server' : 'App'}</td><td>${escape(e.from === 'server' ? e.name : (APP_ERRORS[e.name] ?? e.name))}</td><td class="num">${fmt(e.count)}</td><td class="num">${day(e.lastDay)}</td></tr>`,
    )
    .join('')
  const errors = listCard(
    'Errors',
    'server 500s, and problems apps showed people',
    data.errors.length
      ? `<table class="data"><thead><tr><th>Where</th><th>What</th><th class="num">Times</th><th class="num">Last</th></tr></thead><tbody>${errorRows}</tbody></table>`
      : '<p class="empty">Nothing went wrong.</p>',
    'errors',
  )

  const index = indexOf([
    ['overview', 'Overview', 0],
    ['import', 'Music import', 0],
    ['chart-imports', 'Imports a day', 1],
    ['chart-error-rate', 'Share that failed', 1],
    ['chart-median-time', 'Median import time', 1],
    ['chart-bands', 'How long imports take', 1],
    ['chart-steps', 'Where the time goes', 1],
    ['chart-youtube', 'YouTube', 1],
    ['chart-failures', 'Why imports fail', 1],
    ['chart-sources', 'By source', 1],
    ['listening', 'Listening', 0],
    ...(data.doorman ? [['chart-reads', 'Reads from buckets', 1]] : []),
    ['chart-plays', 'Plays a day', 1],
    ...(data.doorman ? [['chart-reads-by-app', 'Reads by app', 1]] : []),
    ['app', 'The app', 0],
    ['chart-features', 'Features used', 1],
    ['chart-smart', 'Smart features', 1],
    ['chart-errors', 'Errors', 1],
  ])
  return `${header}
    <div class="with-index"><div class="index-main">
    ${state.dataError ? `<p class="notice bad">${escape(state.dataError)}</p>` : ''}
    <div id="overview" class="anchor">${stats}</div>
    <section class="section" id="import"><h2 class="section-title">Music import</h2>
      ${perDay}
      <div class="grid2">${errorCard}${medianCard}</div>
      <div class="grid2">${histogram}${steps}</div>
      <div class="grid2">${youtubeCard}${failures}</div>
      ${sources}
    </section>
    <section class="section" id="listening"><h2 class="section-title">Listening</h2>
      ${doormanNote}${reads}
      <div class="grid2">${playsCard}${byApp}</div>
    </section>
    <section class="section" id="app"><h2 class="section-title">The app</h2>
      <div class="grid2">${usage}${smartCard}</div>
      ${errors}
    </section>
    </div>${index}</div>`
}

const AVATAR_HUES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--good)']

/** The address's first letter, on a tint of its own. */
function avatarOf(email) {
  let hash = 0
  for (const ch of email) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  const hue = AVATAR_HUES[hash % AVATAR_HUES.length]
  const letter = escape(email[0]?.toUpperCase() ?? '?')
  return `<span class="avatar" aria-hidden="true" style="background:color-mix(in oklab, ${hue} 32%, var(--surface2))">${letter}</span>`
}

const ICON_TRASH =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>'
const ICON_SEARCH =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>'
const ICON_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>'
const ICON_PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'

function personRow(person) {
  const chip = person.owner ? '<span class="chip">owner</span>' : ''
  const at = state.added.get(person.email)
  const settling =
    at !== undefined && Date.now() - at < SETTLE_MS
      ? `<span class="hint">Just added: they can sign in by ${escape(new Date(at + SETTLE_MS).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}</span>`
      : ''
  const end = person.owner
    ? '<span class="hint">always let in</span>'
    : `<button class="icon-btn" type="button" data-action="remove" data-email="${escape(person.email)}" aria-label="Remove ${escape(person.email)}" title="Remove" ${state.busy ? 'disabled' : ''}>${ICON_TRASH}</button>`
  return `<div class="row">${avatarOf(person.email)}<div class="lbl"><span class="name">${escape(person.email)}${chip}</span>${settling}</div>${end}</div>`
}

function peopleView() {
  const people = state.people
  const count = people ? people.owners.length + people.emails.length : 0
  const header = head(
    'People',
    people ? escape(`${plural(count, 'person', 'people')} can sign in`) : 'Who can sign in',
  )
  if (!people) {
    const why = state.peopleError
      ? `<p class="notice bad">${escape(state.peopleError)}</p>`
      : '<p class="empty">Loading…</p>'
    return header + why
  }
  const everyone = [
    ...people.owners.map(email => ({ email, owner: true })),
    ...people.emails.map(email => ({ email, owner: false })),
  ].sort((a, b) => a.email.localeCompare(b.email))
  // One field searches and adds: words narrow the list, and whole addresses
  // not on it, typed or pasted many at once, can be added from the top of it.
  const typed = typedOf(state.search)
  const shown =
    typed.words.length > 1
      ? everyone.filter(p => typed.words.includes(p.email))
      : everyone.filter(p => p.email.includes(typed.words[0] ?? ''))
  const rows =
    addRow(typed) +
    (shown.length
      ? shown.map(personRow).join('')
      : typed.fresh.length
        ? ''
        : `<p class="empty">No one matches “${escape(state.search.trim())}”. Type their whole address to add them.</p>`)
  const anyoneHint = people.anyone
    ? 'On: anyone who signs in with Google gets in, whoever they are.'
    : 'Off: only the people above.'
  // The app's search field (SearchField.tsx): a count and a × once there are words.
  const clear = state.search
    ? `<span class="hint">${escape(`${shown.length} of ${count}`)}</span><button class="clear" type="button" data-action="search-clear" aria-label="Clear" title="Clear">${ICON_X}</button>`
    : ''
  return `${header}
    ${state.peopleError ? `<p class="notice bad">${escape(state.peopleError)}</p>` : ''}
    <section class="people">
      <label class="search">${ICON_SEARCH}<input id="people-search" type="text" inputmode="email" placeholder="Search, or type an address to add" value="${escape(state.search)}" aria-label="Search people, or type an address to add" autocomplete="off" spellcheck="false" />${clear}</label>
      <div class="panel"><div class="people-list">${rows}</div></div>
    </section>
    <section class="section">
      <div class="group-head"><span class="label">Sign-in</span></div>
      <div class="panel"><div class="row"><div class="lbl"><span class="name">Anyone with a Google account</span><span class="hint">${anyoneHint}</span></div><input class="switch" type="checkbox" role="switch" aria-label="Anyone with a Google account" data-action="anyone" ${people.anyone ? 'checked' : ''} ${state.busy ? 'disabled' : ''} /></div></div>
    </section>`
}

/** How long ago, in the words a list row has room for. */
function ago(ms) {
  const minutes = Math.round((Date.now() - ms) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return plural(Math.round(hours / 24), 'day', 'days') + ' ago'
}

function iphoneRow(iphone) {
  const name = iphone.name || 'No name given'
  const id = `${iphone.udid.slice(0, 8)}…${iphone.udid.slice(-4)}`
  const when =
    iphone.state === 'added'
      ? `added ${ago(iphone.addedAt ?? iphone.askedAt)}`
      : `asked ${ago(iphone.askedAt)}`
  const add =
    iphone.state === 'waiting'
      ? `<button class="btn primary small" type="button" data-action="iphone-add" data-udid="${escape(iphone.udid)}" ${state.busy ? 'disabled' : ''}>Add</button>`
      : '<span class="chip">added</span>'
  const drop = `<button class="icon-btn" type="button" data-action="iphone-drop" data-udid="${escape(iphone.udid)}" data-name="${escape(name)}" aria-label="Drop ${escape(name)}" title="Drop" ${state.busy ? 'disabled' : ''}>${ICON_TRASH}</button>`
  return `<div class="row">${avatarOf(iphone.name || '?')}<div class="lbl"><span class="name">${escape(name)}</span><span class="hint" title="${escape(iphone.udid)}">${escape(`${when} · ${id}`)}</span></div>${add}${drop}</div>`
}

function iphonesView() {
  const iphones = state.iphones
  const waiting = (iphones ?? []).filter(one => one.state === 'waiting')
  const added = (iphones ?? []).filter(one => one.state === 'added')
  const header = head(
    'iPhones',
    iphones
      ? escape(
          waiting.length
            ? `${plural(waiting.length, 'friend', 'friends')} waiting`
            : 'Friends who asked for the iPhone app',
        )
      : 'Friends who asked for the iPhone app',
  )
  if (!iphones) {
    const why = state.iphonesError
      ? `<p class="notice bad">${escape(state.iphonesError)}</p>`
      : '<p class="empty">Loading…</p>'
    return header + why
  }
  const group = (label, list, empty) =>
    `<section class="section"><div class="group-head"><span class="label">${label}</span></div>
      <div class="panel"><div class="people-list">${list.length ? list.map(iphoneRow).join('') : `<p class="empty">${empty}</p>`}</div></div></section>`
  return `${header}
    ${state.iphonesError ? `<p class="notice bad">${escape(state.iphonesError)}</p>` : ''}
    ${group('Waiting', waiting, 'Nobody is waiting. Friends ask from the install page: xiao215.github.io/selfmp3/install/')}
    ${group('Added', added, 'No iPhones added yet.')}
    <p class="hint iphones-note">Adding one starts a build for it on GitHub, about an hour; their page then says Install. They also need to be on People to sign in.</p>`
}

function dialogView() {
  const c = state.confirm
  if (!c) return ''
  return `<div class="scrim" data-action="confirm-cancel"><div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby="dialog-text">
    <h2 id="dialog-title">${escape(c.title)}</h2><p id="dialog-text">${escape(c.text)}</p>
    <div class="btns"><button class="btn" type="button" data-action="confirm-cancel">Cancel</button><button class="btn ${c.danger ? 'danger' : 'primary'}" type="button" data-action="confirm-ok">${escape(c.ok)}</button></div>
  </div></div>`
}

// ---------- Drawing ----------

function render({ entering = false } = {}) {
  for (const link of document.querySelectorAll('.nav a')) {
    if (link.dataset.tab === state.tab) link.setAttribute('aria-current', 'page')
    else link.removeAttribute('aria-current')
  }
  const searching = document.activeElement?.id === 'people-search'
  const caret = searching ? document.activeElement.selectionStart : null
  const page = document.getElementById('page')
  const view =
    state.tab === 'data' ? dataView() : state.tab === 'people' ? peopleView() : iphonesView()
  page.innerHTML = `<div class="view${entering ? ' entering' : ''}">${view}</div>${dialogView()}`
  document.title = `${{ data: 'Data', people: 'People', iphones: 'iPhones' }[state.tab]} · self.mp3 admin`
  hideTip()
  drawCharts()
  lightIndex()
  if (searching) {
    const input = document.getElementById('people-search')
    input?.focus()
    if (caret !== null) input?.setSelectionRange(caret, caret)
  } else if (state.confirm) {
    document.querySelector('.dialog [data-action="confirm-ok"]')?.focus()
  }
}

let toastTimer = null
function toast(words) {
  const box = document.getElementById('toast')
  box.textContent = words
  box.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (box.hidden = true), 3200)
}

new ResizeObserver(() => drawCharts()).observe(document.getElementById('page'))

// ---------- Acting ----------

/** What adding an iPhone did, as the toast says it. */
const BUILD_WORDS = {
  started: 'a build for it has started, about an hour',
  'not-set-up':
    'the nightly build will carry it (the doorman has no GITHUB_TOKEN to start one now)',
  failed: 'GitHub would not start a build now; the nightly one will carry it',
}

async function changeIphone(udid, method, done) {
  if (state.busy) return
  state.busy = true
  render()
  try {
    const answer = await ask(`/api/admin/iphones/${encodeURIComponent(udid)}`, { method })
    await loadIphones()
    toast(done(answer))
  } catch (error) {
    state.iphonesError = error.message
  } finally {
    state.busy = false
    render()
  }
}

async function savePeople(change, done) {
  if (!state.people || state.busy) return
  const next = change({ anyone: state.people.anyone, emails: [...state.people.emails] })
  const before = new Set(state.people.emails)
  state.busy = true
  render()
  try {
    state.people = await ask('/api/admin/people', { method: 'PUT', body: JSON.stringify(next) })
    state.peopleError = null
    const fresh = state.people.emails.filter(email => !before.has(email))
    if (fresh.length) {
      for (const email of fresh) state.added.set(email, Date.now())
      // The rows say so until then, and stop once it is true.
      setTimeout(() => {
        for (const email of fresh) state.added.delete(email)
        if (state.tab === 'people') render()
      }, SETTLE_MS)
    }
    if (done) toast(done)
  } catch (error) {
    state.peopleError = error.message
  } finally {
    state.busy = false
    render()
  }
}

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/

/** What is typed in People's field: its words, and which are addresses to add. */
function typedOf(text) {
  const words = [
    ...new Set(
      text
        .split(/[\s,;]+/)
        .map(w => w.trim().toLowerCase())
        .filter(Boolean),
    ),
  ]
  const known = new Set([...(state.people?.emails ?? []), ...(state.people?.owners ?? [])])
  const addresses = words.filter(w => EMAIL.test(w))
  return {
    words,
    fresh: addresses.filter(w => !known.has(w)),
    // Only pasted lists say what isn't an address: one word is a search.
    wrong: words.length > 1 ? words.filter(w => !EMAIL.test(w)) : [],
  }
}

/** The top of the list while what is typed holds addresses not on it. */
function addRow({ fresh, wrong }) {
  if (!fresh.length) return ''
  const name =
    fresh.length === 1 ? `Add ${fresh[0]}` : `Add ${plural(fresh.length, 'person', 'people')}`
  const notes = [
    fresh.length > 1 ? fresh.join(', ') : null,
    wrong.length ? `Not an address, left out: ${wrong.join(', ')}` : null,
    'While Google sign-in is in Testing, add them as test users there too.',
  ].filter(Boolean)
  return `<div class="row add-row"><span class="avatar add" aria-hidden="true">${ICON_PLUS}</span><div class="lbl"><span class="name">${escape(name)}</span>${notes.map(n => `<span class="hint">${escape(n)}</span>`).join('')}</div><button class="btn primary small" type="button" data-action="add-typed" ${state.busy ? 'disabled' : ''}>Add</button></div>`
}

function addTyped() {
  const { fresh } = typedOf(state.search)
  if (!fresh.length || state.busy) return
  state.search = ''
  void savePeople(
    list => ({ ...list, emails: [...list.emails, ...fresh] }),
    `${fresh.length === 1 ? `Added ${fresh[0]}` : `Added ${plural(fresh.length, 'person', 'people')}`}. They can sign in within a minute.`,
  )
}

async function go(tab, { push = true } = {}) {
  state.tab = tab
  if (push) history.pushState(null, '', `/${tab}`)
  render({ entering: true })
  if (tab === 'data') await loadData()
  else if (tab === 'people') await loadPeople()
  else await loadIphones()
  render()
}

document.addEventListener('click', event => {
  const target = event.target instanceof Element ? event.target : null
  if (!target) return
  const link = target.closest('a[data-tab], a.brand')
  if (link && !event.metaKey && !event.ctrlKey) {
    event.preventDefault()
    void go(link.dataset.tab ?? 'data')
    return
  }
  const entry = target.closest('.index a')
  if (entry) {
    // Scrolled to here rather than followed: following `#id` is a step in the
    // history, which would draw the page again.
    event.preventDefault()
    pinned = entry.dataset.index
    lightIndex()
    document.getElementById(pinned)?.scrollIntoView({ block: 'start' })
    return
  }
  const range = target.closest('button[data-range]')
  if (range) {
    state.days = Number(range.dataset.range)
    try {
      localStorage.setItem(RANGE_KEY, String(state.days))
    } catch {
      // Remembered for this visit only.
    }
    render()
    void loadData().then(() => render())
    return
  }
  const tableToggle = target.closest('button[data-table]')
  if (tableToggle) {
    const id = tableToggle.dataset.table
    if (state.tables.has(id)) state.tables.delete(id)
    else state.tables.add(id)
    render()
    return
  }
  const action = target.closest('[data-action]')
  if (!action) return
  const kind = action.getAttribute('data-action')
  // A press inside the dialog is not a press on the scrim behind it.
  if (kind === 'confirm-cancel' && action.classList.contains('scrim') && target !== action) return
  switch (kind) {
    case 'search-clear':
      state.search = ''
      render()
      document.getElementById('people-search')?.focus()
      break
    case 'add-typed':
      addTyped()
      break
    case 'remove': {
      const email = action.getAttribute('data-email')
      state.confirm = {
        title: `Remove ${email}?`,
        text: 'They are signed out of every device within a minute, and this server lets go of their library. Their songs stay in their own bucket, and adding them again brings everything back.',
        ok: 'Remove',
        danger: true,
        run: () =>
          savePeople(
            list => ({ ...list, emails: list.emails.filter(e => e !== email) }),
            `Removed ${email}`,
          ),
      }
      render()
      break
    }
    case 'iphone-add': {
      const udid = action.getAttribute('data-udid')
      const name = state.iphones?.find(one => one.udid === udid)?.name || 'their iPhone'
      void changeIphone(udid, 'PUT', answer => `Added ${name}: ${BUILD_WORDS[answer.build]}`)
      break
    }
    case 'iphone-drop': {
      const udid = action.getAttribute('data-udid')
      const name = action.getAttribute('data-name')
      state.confirm = {
        title: `Drop ${name}?`,
        text: 'They leave this list. An iPhone already registered with Apple stays registered, and builds keep installing on it, until the membership year ends.',
        ok: 'Drop',
        danger: true,
        run: () => changeIphone(udid, 'DELETE', () => `Dropped ${name}`),
      }
      render()
      break
    }
    case 'confirm-cancel':
      state.confirm = null
      render()
      break
    case 'confirm-ok': {
      const run = state.confirm?.run
      state.confirm = null
      render()
      void run?.()
      break
    }
  }
})

document.addEventListener('change', event => {
  const input = event.target
  if (!(input instanceof HTMLInputElement) || input.dataset.action !== 'anyone') return
  const on = input.checked
  input.checked = !on
  if (!on) {
    void savePeople(list => ({ ...list, anyone: false }), 'Only the people on the list can sign in')
    return
  }
  state.confirm = {
    title: 'Let anyone with a Google account in?',
    text: 'Anyone who signs in with Google can then use this server: imports from its address and Smart features on its model. The list stays, for when you turn this off.',
    ok: 'Let anyone in',
    danger: false,
    run: () =>
      savePeople(list => ({ ...list, anyone: true }), 'Anyone with a Google account can sign in'),
  }
  render()
})

document.addEventListener('input', event => {
  const input = event.target
  if (input instanceof HTMLInputElement && input.id === 'people-search') {
    state.search = input.value
    render()
  }
})

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && state.confirm) {
    state.confirm = null
    render()
    return
  }
  if (event.target instanceof HTMLInputElement && event.target.id === 'people-search') {
    if (event.key === 'Enter') addTyped()
    else if (event.key === 'Escape' && state.search) {
      state.search = ''
      render()
    }
  }
})

document.addEventListener('scroll', lightIndexSoon, { capture: true, passive: true })
window.addEventListener('resize', lightIndexSoon)
for (const type of ['wheel', 'touchstart', 'keydown']) {
  window.addEventListener(
    type,
    () => {
      pinned = null
    },
    { passive: true },
  )
}
window.addEventListener('popstate', () => {
  const tab = tabOf(location.pathname)
  if (tab !== state.tab) void go(tab, { push: false })
})

// A page left open keeps its numbers current while it is being looked at.
setInterval(() => {
  if (document.visibilityState !== 'visible' || state.busy || state.confirm || state.tab !== 'data')
    return
  void loadData().then(() => render())
}, REFRESH_MS)

if (location.pathname === '/') history.replaceState(null, '', '/data')
void go(state.tab, { push: false })
