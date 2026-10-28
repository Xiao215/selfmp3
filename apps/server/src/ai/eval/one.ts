import fs from 'node:fs'
import { WrappedRangeSchema } from '@selfmp3/shared'
import { cardWords, replyWords } from './judge.js'
import type { EvalWorld } from './run.js'

/**
 * One question asked of one smart feature, printed for a person to read
 * (`run.ts --one <kind> "<words>"`): what the old one-off eval did, over the
 * same library copy the harness uses.
 *
 *   --one ask "something calmer like this next"     (PLAYING=<song id> for "this")
 *   --one describe "calm piano for reading"
 *   --one tags | --one tidy | --one written month
 *   --one import <rows file> ["list name"]           (a row a line: title | artist | album)
 *
 * "fill in what's missing" and "which songs do I have twice" go through `ask`.
 */

/* eslint-disable no-console -- a script's output is its console. */

export async function one(world: EvalWorld, kind: string, words: readonly string[]): Promise<void> {
  const { smart, song } = world
  switch (kind) {
    case 'ask': {
      const playing = process.env['PLAYING'] ? Number(process.env['PLAYING']) : null
      console.log(replyWords(await smart.ask(words.join(' '), { playing, screen: null }), song))
      return
    }
    case 'describe': {
      const result = await smart.describe({ text: words.join(' '), understanding: null })
      console.log(cardWords({ kind: 'songs', lead: 'play', describe: result, like: null }, song))
      return
    }
    case 'tags':
      console.log(cardWords({ kind: 'tags', review: await smart.untaggedTags() }, song))
      return
    case 'tidy':
      console.log(cardWords({ kind: 'tidy', tidy: await smart.tidy() }, song))
      return
    case 'written': {
      const result = await smart.written(WrappedRangeSchema.parse(words[0] ?? 'month'))
      for (const sentence of result.sentences) console.log(sentence)
      console.log(`(${result.dropped} dropped)`)
      return
    }
    case 'import': {
      const [rowsFile = '', list] = words
      const rows = fs
        .readFileSync(rowsFile, 'utf8')
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
          const [title = '', artist = '', album = ''] = line.split('|').map(part => part.trim())
          return { title, artist, album }
        })
      const { suggestions } = await smart.importNames({ list: list ?? null, rows })
      console.log(`${rows.length} rows · ${suggestions.length} suggestions`)
      for (const each of suggestions) {
        const row = rows[each.row]!
        console.log(
          `${each.row + 1}. ${row.title} · ${row.artist} · ${row.album}\n   → ${each.title} · ${each.artist} · ${each.album}  (${each.why})`,
        )
      }
      return
    }
    default:
      throw new Error(`--one takes ask, describe, tags, tidy, written or import, not ${kind}`)
  }
}
