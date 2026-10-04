import Database from 'better-sqlite3'
import { WrappedRangeSchema, type TagReview } from '@selfmp3/shared'
import { loadConfig } from '../config.js'
import { createLogger } from '../logger.js'
import { LyricsSearchRepository } from '../repositories/lyricsSearch.js'
import { SongRepository } from '../repositories/songs.js'
import { StatsRepository } from '../repositories/stats.js'
import { TagRepository } from '../repositories/tags.js'
import { WrappedRepository } from '../repositories/wrapped.js'
import { SmartFeatures, llmFor, setupFor } from './smart.js'

/**
 * Asks the real model about a real library and prints what came back, for a
 * person to read (docs/features/ai.md, "Testing"). Whether "calm piano" gives
 * calm piano is a judgement, not a unit test.
 *
 *   npx tsx apps/server/src/ai/eval.ts <copy of selfmp3.db> describe "calm piano for reading"
 *   npx tsx apps/server/src/ai/eval.ts <copy of selfmp3.db> tags
 *   npx tsx apps/server/src/ai/eval.ts <copy of selfmp3.db> ask "tag the songs that should be 中文流行"
 *   npx tsx apps/server/src/ai/eval.ts <copy of selfmp3.db> tidy
 *   npx tsx apps/server/src/ai/eval.ts <copy of selfmp3.db> written month
 *   PLAYING=<song id> npx tsx apps/server/src/ai/eval.ts <copy of selfmp3.db> ask "something calmer like this next"
 *
 * The database is opened read-only, and nothing but the model is reached:
 * no server starts and no bucket is touched. Point it at a copy all the same
 * (`sqlite3 selfmp3.db ".backup /tmp/copy.db"`). The model comes from the same
 * SELFMP3_AI_* settings the server reads.
 */

/* eslint-disable no-console -- a script's output is its console. */

const [file, what, ...words] = process.argv.slice(2)
if (!file || !['describe', 'tags', 'ask', 'tidy', 'written'].includes(what ?? '')) {
  console.error(
    'usage: eval.ts <db file> describe "<words>" | ask "<words>" | tags | tidy | written [week|month|…]',
  )
  process.exit(2)
}

const config = loadConfig()
const logger = createLogger('info')
const db = new Database(file, { readonly: true })
const songs = new SongRepository(db)
const tags = new TagRepository(db)
const stats = new StatsRepository(db)
const lyrics = new LyricsSearchRepository(db)
const wrapped = new WrappedRepository(db)
const smart = new SmartFeatures({
  llm: llmFor(config, logger),
  setup: setupFor(config),
  songs: () => songs.all(),
  tags: () => tags.all(),
  stats: range => stats.build(range),
  lyrics: query => lyrics.search(query).map(row => ({ songId: row.song_id, line: row.line })),
  wrapped: range => wrapped.build(range),
})
const titleOf = new Map(songs.all().map(song => [song.id, `${song.title} · ${song.artist}`]))

if (what === 'ask') {
  // PLAYING=<song id> asks as if that song were playing (A8).
  const playing = process.env['PLAYING'] ? Number(process.env['PLAYING']) : null
  const answer = await smart.ask(words.join(' '), playing)
  if (answer.kind === 'tags') {
    printTagReview(answer.review)
    process.exit(0)
  }
  const shown =
    'describe' in answer
      ? { ...answer, describe: { ...answer.describe, picks: undefined } }
      : answer
  console.log(
    JSON.stringify(
      shown,
      (key, value: unknown) =>
        key === 'songIds' && Array.isArray(value) ? `${value.length} songs` : value,
      2,
    ),
  )
  const picks =
    answer.kind === 'songs' ? answer.describe.picks : answer.kind === 'find' ? answer.picks : []
  for (const pick of picks) console.log(`- ${titleOf.get(pick.songId)}  (${pick.why ?? 'fits'})`)
} else if (what === 'describe') {
  const result = await smart.describe({ text: words.join(' '), understanding: null })
  console.log(JSON.stringify({ ...result, picks: undefined }, null, 2))
  for (const pick of result.picks)
    console.log(`- ${titleOf.get(pick.songId)}  (${pick.why ?? 'fits'})`)
} else if (what === 'written') {
  const range = WrappedRangeSchema.parse(words[0] ?? 'month')
  const result = await smart.written(range)
  for (const sentence of result.sentences) console.log(sentence)
  console.log(`(${result.dropped} dropped)`)
} else if (what === 'tidy') {
  const result = await smart.tidy()
  console.log(`${result.looked} songs looked at · ${result.changes.length} changes`)
  if (result.note) console.log(result.note)
  for (const each of result.changes) {
    console.log(
      `${each.field} · ${each.from} → ${each.to} · ${each.songIds.length} · ${each.why} [${each.by}]`,
    )
  }
} else {
  const result = await smart.untaggedTags()
  printTagReview(result)
}

function printTagReview(result: TagReview): void {
  console.log(`${result.looked} songs looked at · ${result.changes.length} changes`)
  if (result.note) console.log(result.note)
  for (const each of result.changes) {
    const what = each.to ? `${each.tag} → ${each.to}` : each.tag
    console.log(
      `${each.op} ${each.isNew ? 'NEW ' : ''}${what} · ${each.songIds.length} · ${each.who} · ${each.why} [${each.by}]`,
    )
  }
  for (const each of result.unsure) console.log(`unsure · ${each.who} · ${each.why}`)
}
