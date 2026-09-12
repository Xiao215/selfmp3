#!/usr/bin/env node
/**
 * The comparison sheet for check 2 in docs/UNIVERSAL.md: every state in the
 * reference set beside the new app's capture of the same state, at both widths.
 *
 *   node verify/side-by-side.mjs docs/reference/<sha> verify/captures [out.html]
 *
 * A review, not a diff — fonts render differently under react-native-web, so a
 * pixel comparison would fail on every run. The sheet only lines the two up,
 * and says plainly which states the new app has no capture for, which is the
 * part a reviewer would otherwise have to notice by absence.
 *
 * Images are embedded, so the one file can be attached to a PR as it is.
 */
import fs from 'node:fs'
import path from 'node:path'

const [reference, captures, out = path.join(captures ?? '.', 'side-by-side.html')] =
  process.argv.slice(2)

if (!reference || !captures) {
  console.error('usage: node verify/side-by-side.mjs <reference dir> <captures dir> [out.html]')
  process.exit(2)
}

const WIDTHS = ['desktop', 'phone']

const pngs = dir =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(name => name.endsWith('.png')).map(name => name.slice(0, -4))
    : []

const embed = file => `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`

const escape = text =>
  text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

let missing = 0
let extra = 0
const sections = WIDTHS.map(width => {
  const before = new Set(pngs(path.join(reference, width)))
  const after = new Set(pngs(path.join(captures, width)))
  const states = [...new Set([...before, ...after])].sort()

  const rows = states.map(state => {
    const cell = (dir, has, label) =>
      has
        ? `<img src="${embed(path.join(dir, width, `${state}.png`))}" alt="${label}: ${escape(state)}">`
        : `<div class="none">no ${label.toLowerCase()} capture</div>`
    if (!after.has(state)) missing++
    if (!before.has(state)) extra++
    return `<tr><th>${escape(state)}</th><td>${cell(reference, before.has(state), 'Reference')}</td><td>${cell(captures, after.has(state), 'New')}</td></tr>`
  })

  return `<h2>${width}</h2><table><thead><tr><th>State</th><th>Reference</th><th>New app</th></tr></thead><tbody>${rows.join('')}</tbody></table>`
})

const html = `<!doctype html><meta charset="utf-8"><title>Side by side</title>
<style>
body{font:14px system-ui,sans-serif;margin:24px;background:#111;color:#eee}
table{border-collapse:collapse;width:100%}th,td{border-top:1px solid #333;padding:8px;vertical-align:top;text-align:left}
td{width:45%}img{max-width:100%;display:block}.none{padding:40px;border:1px dashed #555;color:#999;text-align:center}
</style>
<h1>Reference ${escape(path.basename(reference))} beside ${escape(captures)}</h1>
<p>${missing} reference state(s) with no new capture · ${extra} new capture(s) with no reference.</p>
${sections.join('\n')}`

fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, html)
console.log(`${out}: ${missing} missing, ${extra} extra`)
