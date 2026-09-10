#!/usr/bin/env node
/**
 * Migrate a "hum" v1 folder into a running self.mp3.
 *
 *   node scripts/migrate-from-hum.mjs <path-to-old-hum-dir> [--url http://localhost:4600]
 *                                     [--token …] [--dry-run] [--no-plays]
 *
 * What it does, in order:
 *   1. copies audio and .lrc/.txt sidecars from <old>/library into the new
 *      library folder (whatever the running server reports), skipping files
 *      that are already there;
 *   2. asks the server to rescan;
 *   3. recreates the old tags by name (existing ones are reused, never duplicated)
 *      and links them to songs matched by file path, then by file name;
 *   4. carries play counts across when the old schema has them.
 *
 * Everything that touches the new database goes through the server's API, so
 * there is no second copy of the schema here. The old hum.db is opened
 * read-only and never modified; run it twice and the second run is a no-op.
 */

import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { createRequire } from 'node:module'

// better-sqlite3 is the server's own driver, resolved from the workspace root.
const require = createRequire(new URL('../apps/server/package.json', import.meta.url))
const Database = require('better-sqlite3')

const AUDIO = new Set(['.m4a', '.mp3', '.flac', '.wav', '.ogg', '.opus', '.aac', '.wma', '.aiff'])
const SIDECAR = new Set(['.lrc', '.txt'])

// --- arguments --------------------------------------------------------------

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: 'string' },
    token: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    'no-plays': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
})

const [oldDir] = positionals
if (values.help || !oldDir) {
  console.log(
    'usage: node scripts/migrate-from-hum.mjs <path-to-old-hum-dir> [--url http://localhost:4600] [--token …] [--dry-run] [--no-plays]',
  )
  process.exit(values.help ? 0 : 2)
}

const baseUrl = (values.url ?? `http://localhost:${process.env.SELFMP3_PORT ?? '4600'}`).replace(
  /\/+$/,
  '',
)
const dryRun = values['dry-run']

// --- helpers ----------------------------------------------------------------

const headers = { 'content-type': 'application/json' }
if (values.token) headers.authorization = `Bearer ${values.token}`

async function api(method, route, body) {
  const response = await fetch(`${baseUrl}/api${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(`${method} ${route} → ${response.status}: ${payload?.error ?? response.statusText}`)
  }
  return payload
}

function fail(message) {
  console.error(`\n${message}`)
  process.exit(1)
}

function columnsOf(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name))
}

const normalise = name => name.trim().replace(/\s+/g, ' ').toLowerCase()

// --- 0. sanity checks -------------------------------------------------------

const oldRoot = path.resolve(oldDir)
const oldDb = path.join(oldRoot, 'data', 'hum.db')
const oldLibrary = path.join(oldRoot, 'library')

if (!fs.existsSync(oldDb)) fail(`no database at ${oldDb} — is ${oldRoot} really the old hum folder?`)
if (!fs.existsSync(oldLibrary)) fail(`no library folder at ${oldLibrary}`)

let health
try {
  health = await api('GET', '/health')
} catch (error) {
  fail(
    `self.mp3 is not running at ${baseUrl} (${error.message}).\n` +
      'Start it first — `npm start` or `selfmp3 start` — then run this again.\n' +
      'If it lives elsewhere, pass --url.',
  )
}
if (health.storageDriver !== 'local') {
  fail(`the server uses the "${health.storageDriver}" storage driver; this script only copies to a local library folder`)
}

const newLibrary = health.libraryPath
console.log(`self.mp3 ${health.version} at ${baseUrl}`)
console.log(`  from  ${oldRoot}`)
console.log(`  into  ${newLibrary}${dryRun ? '   (dry run — nothing will be written)' : ''}`)
console.log()

const db = new Database(oldDb, { readonly: true, fileMustExist: true })
const songColumns = columnsOf(db, 'songs')
for (const required of ['id', 'path']) {
  if (!songColumns.has(required)) fail(`old songs table has no "${required}" column; cannot migrate`)
}
const hasPlayCount = songColumns.has('play_count') && !values['no-plays']

// --- 1. copy files ----------------------------------------------------------

console.log('files')
let copied = 0
let skipped = 0
let bytes = 0
for (const entry of fs.readdirSync(oldLibrary, { withFileTypes: true, recursive: true })) {
  if (!entry.isFile()) continue
  const ext = path.extname(entry.name).toLowerCase()
  if (!AUDIO.has(ext) && !SIDECAR.has(ext)) continue
  if (entry.name.startsWith('.')) continue

  const src = path.join(entry.parentPath, entry.name)
  const relative = path.relative(oldLibrary, src)
  const dest = path.join(newLibrary, relative)

  if (fs.existsSync(dest)) {
    skipped += 1
    continue
  }
  const size = fs.statSync(src).size
  bytes += size
  copied += 1
  console.log(`  + ${relative}`)
  if (!dryRun) {
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(src, dest)
  }
}
console.log(`  ${copied} copied (${(bytes / 1_048_576).toFixed(1)} MB), ${skipped} already there`)
console.log()

// --- 2. rescan --------------------------------------------------------------

if (!dryRun) {
  const scan = await api('POST', '/library/scan')
  console.log(`scan: ${scan.added} added, ${scan.updated} updated, ${scan.total} songs total`)
  console.log()
}

// --- 3. match songs ---------------------------------------------------------

const library = await api('GET', '/library')
const byPath = new Map(library.songs.map(song => [song.path, song]))
const byName = new Map()
for (const song of library.songs) {
  const name = path.basename(song.path)
  // Two songs with the same file name in different folders are ambiguous; skip
  // the shortcut for those rather than guess.
  byName.set(name, byName.has(name) ? null : song)
}

const oldSongs = db.prepare('SELECT * FROM songs').all()
const songMap = new Map() // old id → new song
const unmatched = []
for (const old of oldSongs) {
  const match = byPath.get(old.path) ?? byName.get(path.basename(old.path)) ?? null
  if (match) songMap.set(old.id, match)
  else unmatched.push(old.path)
}
console.log(`songs: ${songMap.size} of ${oldSongs.length} matched`)
for (const missing of unmatched) console.log(`  ? ${missing}  (not in the new library; is the file there?)`)
console.log()

// --- 4. tags ----------------------------------------------------------------

console.log('tags')
const existingTags = new Map(library.tags.map(tag => [normalise(tag.name), tag]))
const tagMap = new Map() // old id → new id
let createdTags = 0
for (const old of db.prepare('SELECT id, name FROM tags').all()) {
  const name = old.name.trim().replace(/\s+/g, ' ')
  if (!name) continue
  const existing = existingTags.get(normalise(name))
  if (existing) {
    tagMap.set(old.id, existing.id)
    console.log(`  = ${name}`)
    continue
  }
  createdTags += 1
  console.log(`  + ${name}`)
  if (dryRun) continue
  const created = await api('POST', '/tags', { name })
  existingTags.set(normalise(name), created)
  tagMap.set(old.id, created.id)
}

let links = 0
let linksSkipped = 0
const songTags = db.prepare('SELECT song_id, tag_id FROM song_tags').all()
const perTag = new Map() // new tag id → new song ids
for (const link of songTags) {
  const song = songMap.get(link.song_id)
  const tagId = tagMap.get(link.tag_id)
  if (!song || tagId === undefined) {
    linksSkipped += 1
    continue
  }
  if (song.tagIds.includes(tagId)) {
    linksSkipped += 1
    continue
  }
  links += 1
  if (!perTag.has(tagId)) perTag.set(tagId, [])
  perTag.get(tagId).push(song.id)
}
if (!dryRun) {
  for (const [tagId, songIds] of perTag) {
    await api('POST', '/tags/bulk', { tagId, songIds, action: 'add' })
  }
}
console.log(`  ${createdTags} created, ${tagMap.size - createdTags} reused; ${links} links added, ${linksSkipped} already present or unmatched`)
console.log()

// --- 5. play counts ---------------------------------------------------------

if (hasPlayCount) {
  console.log('play counts')
  let songsWithPlays = 0
  let plays = 0
  for (const old of oldSongs) {
    const song = songMap.get(old.id)
    const count = Number(old.play_count) || 0
    // Only when the new side has never been played: a second run, or a library
    // that was already in use, must not double up.
    if (!song || count <= 0 || song.playCount > 0) continue
    songsWithPlays += 1
    plays += count
    if (dryRun) continue
    const msPlayed = Math.round((song.duration || 0) * 1000)
    for (let i = 0; i < count; i += 1) {
      await api('POST', `/songs/${song.id}/played`, { msPlayed, completed: true })
    }
  }
  console.log(`  ${plays} plays carried over on ${songsWithPlays} songs`)
  console.log('  (recorded as of now — hum did not keep per-play timestamps, so history charts start today)')
  console.log()
} else if (!values['no-plays']) {
  console.log('play counts: the old database has none; skipped\n')
}

db.close()
console.log(dryRun ? 'dry run finished; nothing was changed.' : 'done. Open the app and hit refresh.')
