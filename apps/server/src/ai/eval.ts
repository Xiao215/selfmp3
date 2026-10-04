import Database from 'better-sqlite3'
import { loadConfig } from '../config.js'
import { createLogger } from '../logger.js'
import { LyricsSearchRepository } from '../repositories/lyricsSearch.js'
import { SongRepository } from '../repositories/songs.js'
import { StatsRepository } from '../repositories/stats.js'
import { TagRepository } from '../repositories/tags.js'
import { SmartFeatures, llmFor } from './smart.js'

/**
 * Asks the real model about a real library and prints what came back, for a
 * person to read (docs/features/ai.md, "Testing"). Whether "calm piano" gives
 * calm piano is a judgement, not a unit test.
 *
 *   npx tsx apps/server/src/ai/eval.ts <copy of selfmp3.db> describe "calm piano for reading"
 *   npx tsx apps/server/src/ai/eval.ts <copy of selfmp3.db> tags
 *   npx tsx apps/server/src/ai/eval.ts <copy of selfmp3.db> ask "tag every 周杰倫 song 中文流行"
 *
 * The database is opened read-only, and nothing but the model is reached:
 * no server starts and no bucket is touched. Point it at a copy all the same
 * (`sqlite3 selfmp3.db ".backup /tmp/copy.db"`). The model comes from the same
 * SELFMP3_AI_* settings the server reads.
 */

/* eslint-disable no-console -- a script's output is its console. */

const [file, what, ...words] = process.argv.slice(2)
if (!file || (what !== 'describe' && what !== 'tags' && what !== 'ask')) {
  console.error('usage: eval.ts <db file> describe "<words>" | ask "<words>" | tags')
  process.exit(2)
}

const config = loadConfig()
const logger = createLogger('info')
const db = new Database(file, { readonly: true })
const songs = new SongRepository(db)
const tags = new TagRepository(db)
const stats = new StatsRepository(db)
const lyrics = new LyricsSearchRepository(db)
const smart = new SmartFeatures({
  llm: llmFor(config, logger),
  songs: () => songs.all(),
  tags: () => tags.all(),
  stats: range => stats.build(range),
  lyrics: query => lyrics.search(query).map(row => ({ songId: row.song_id, line: row.line })),
})
const titleOf = new Map(songs.all().map(song => [song.id, `${song.title} · ${song.artist}`]))

if (what === 'ask') {
  const answer = await smart.ask(words.join(' '))
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
} else {
  const result = await smart.suggestTags()
  console.log(`${result.untagged} untagged`)
  for (const each of result.suggestions) {
    console.log(
      `${each.isNew ? 'NEW ' : ''}${each.tag} · ${each.songIds.length} · ${each.who} · ${each.why} [${each.from}]`,
    )
  }
  for (const each of result.unsure) console.log(`unsure · ${each.who} · ${each.why}`)
}
