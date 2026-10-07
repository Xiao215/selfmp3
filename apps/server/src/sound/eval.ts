import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { createLogger } from '../logger.js'
import { migrate } from '../db/migrate.js'
import { SoundVectorsRepository } from '../repositories/soundVectors.js'
import { SOUND_MODEL } from './models.js'
import { SoundService } from './sound.js'

/**
 * The listening model on real songs, printed for a person to read
 * (docs/features/audio-intelligence.md, "How songs sound"). Whether "calm
 * orchestral" finds calm orchestral music is a judgement, not a unit test.
 *
 *   npx tsx apps/server/src/sound/eval.ts <models> <folder of songs> "calm orchestral music" "solo piano"
 *
 * <models> is a folder holding the exported files, or the release's address.
 * Every song in the folder is heard (LIMIT=<n> for fewer), with how long each
 * took; then each description's closest songs, and the first song's nearest
 * neighbours. OUT=<file> writes the vectors as JSON, keyed by file name.
 * Nothing is kept: the database is in memory, and models fetched from an
 * address land in a temporary folder.
 */

/* eslint-disable no-console -- a script's output is its console. */

const [models, folder, ...queries] = process.argv.slice(2)
if (!models || !folder) {
  console.error('usage: eval.ts <models folder or URL> <folder of songs> ["description" …]')
  process.exit(2)
}

const logger = createLogger('info')
const db = new Database(':memory:')
migrate(db, logger)
const vectors = new SoundVectorsRepository(db)
const sound = new SoundService({
  config: {
    dataDir: fs.mkdtempSync(path.join(process.env['TMPDIR'] ?? '/tmp', 'selfmp3-sound-')),
    sound: { enabled: true, models, threads: Number(process.env['THREADS'] ?? 2) },
  },
  vectors,
  logger,
})
if (!(await sound.prepare())) {
  console.error('could not get the model:', sound.status().message)
  process.exit(1)
}

const files = fs
  .readdirSync(folder)
  .filter(name => /\.(m4a|mp3|opus|ogg|flac|wav|webm)$/i.test(name))
  .slice(0, Number(process.env['LIMIT'] ?? Infinity))
const insert = db.prepare('INSERT INTO songs (id, path, title, uid) VALUES (?, ?, ?, ?)')
const times: number[] = []
files.forEach((name, index) => insert.run(index + 1, name, name, `eval-${index + 1}`))
for (const [index, name] of files.entries()) {
  const file = path.join(folder, name)
  const duration = Number(
    execFileSync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'csv=p=0',
      file,
    ]),
  )
  const startedAt = Date.now()
  try {
    await sound.hear(index + 1, file, duration)
    times.push(Date.now() - startedAt)
  } catch (error) {
    console.log(`could not hear ${name}: ${error instanceof Error ? error.message : String(error)}`)
  }
}
const sorted = [...times].sort((a, b) => a - b)
console.log(
  `heard ${times.length} of ${files.length}; median ${sorted[Math.floor(sorted.length / 2)] ?? 0} ms a song`,
)

const ids = files.map((_, index) => index + 1)
const top = (scores: Map<number, number> | null): string =>
  [...(scores ?? new Map<number, number>()).entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, score]) => `  ${score.toFixed(3)}  ${files[id - 1]}`)
    .join('\n')
for (const query of queries) {
  const startedAt = Date.now()
  const scores = await sound.match(query, ids)
  console.log(`\n“${query}” (${Date.now() - startedAt} ms)\n${top(scores)}`)
}
if (files.length > 1) console.log(`\nSounds like ${files[0]}\n${top(sound.closeTo(1, ids))}`)

const out = process.env['OUT']
if (out) {
  const all = vectors.all(SOUND_MODEL.name)
  fs.writeFileSync(
    out,
    JSON.stringify(
      Object.fromEntries(files.map((name, index) => [name, Array.from(all.get(index + 1) ?? [])])),
    ),
  )
}
await sound.close()
