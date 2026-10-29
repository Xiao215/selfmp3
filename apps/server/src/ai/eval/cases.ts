import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import { ExpectSchema } from './checks.js'

/**
 * The eval's cases (AGENT-DESIGN 4): conversations with what each turn
 * should come to. They are written against one library and kept beside its
 * copy, outside the repository, since they name its songs; the repository
 * holds a small made-up set (`example.cases.json`) its test runs on.
 *
 * A file is a list of cases. A song is named by its title, or `title ·
 * artist` when the title is not enough, and found when the cases are loaded.
 */

const TurnSchema = z
  .object({
    text: z.string().min(1),
    /** The song playing when it is asked: what "this" means. */
    playing: z.string().optional(),
    /**
     * What is on the screen ("these"): the newest earlier answer that showed
     * songs (`previous`, a follow-up's default), none (`none`, the first
     * turn's, or the chip let go), or one earlier answer by handle (`t1.1`).
     */
    screen: z.union([z.enum(['previous', 'none']), z.string().regex(/^t\d+\.\d+$/)]).optional(),
    expect: ExpectSchema.default({}),
    /** What a right answer is, in a sentence, with the facts the judge needs. */
    judge: z.string().optional(),
  })
  .strict()

const CaseSchema = z
  .object({
    id: z.string().regex(/^[\w-]+$/),
    class: z.string(),
    note: z.string().optional(),
    turns: z.array(TurnSchema).min(1),
  })
  .strict()

export type EvalCase = z.infer<typeof CaseSchema>

/** Every case in a file or a folder of `*.json` files, checked and with each song found. */
export function loadCases(db: Database.Database, where: string): EvalCase[] {
  const files = fs.statSync(where).isDirectory()
    ? fs
        .readdirSync(where)
        .filter(name => name.endsWith('.json'))
        .sort()
        .map(name => path.join(where, name))
    : [where]
  const cases = files.flatMap(file => {
    const parsed = z.array(CaseSchema).safeParse(JSON.parse(fs.readFileSync(file, 'utf8')))
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      throw new Error(`${file}: ${issue?.path.join('.')}: ${issue?.message}`)
    }
    return parsed.data
  })
  const seen = new Set<string>()
  for (const each of cases) {
    if (seen.has(each.id)) throw new Error(`Two cases are called ${each.id}`)
    seen.add(each.id)
    for (const turn of each.turns) if (turn.playing !== undefined) songNamed(db, turn.playing)
  }
  return cases
}

/** The one song a case names, by `title` or `title · artist`. */
export function songNamed(db: Database.Database, name: string): number {
  const [title = '', artist] = name.split(' · ').map(part => part.trim())
  const rows = (
    artist === undefined
      ? db.prepare('SELECT id FROM songs WHERE title = ?').all(title)
      : db.prepare('SELECT id FROM songs WHERE title = ? AND artist = ?').all(title, artist)
  ) as { id: number }[]
  if (rows.length !== 1)
    throw new Error(`“${name}” names ${rows.length} songs: say “title · artist”`)
  return rows[0]!.id
}
