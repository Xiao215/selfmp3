import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { AskReply } from '@selfmp3/shared'
import { sha256 } from '../../util/hash.js'
import type { Llm } from '../llm.js'
import { loadCases, songNamed } from './cases.js'
import {
  replyWords,
  judgeConversation,
  JUDGE_VERSION,
  type JudgedTurn,
  type TurnToJudge,
} from './judge.js'
import type { EvalWorld } from './run.js'

/**
 * The judge held to a person's verdicts (`run.ts --judge opus --calibrate
 * <labels.json>`): earlier runs' answers, already graded by hand, judged
 * again, and how often the two agree. A judge that does not agree with the
 * person at least nine times in ten is not yet a measure.
 *
 * A labels file names earlier runs' results (the old runner's `.jsonl`, a
 * conversation a line, songs written as `title · artist · album`) and the
 * person's verdict on each turn, `case#turn`: P did what was meant, ~ partly,
 * F failed. Only P is a pass. The cases' judge sentences and songs playing
 * come from the cases folder, by id.
 */

const LabelsSchema = z.object({
  runs: z.array(
    z.object({
      name: z.string(),
      /** The run's results, from the labels file's folder. */
      out: z.string(),
      labels: z.record(z.enum(['P', '~', 'F'])),
      /** Only these cases of it, when given: a calibration set smaller than every label. */
      only: z.array(z.string()).optional(),
    }),
  ),
})

const OldTurnSchema = z.object({
  asked: z.string(),
  status: z.number(),
  answer: z.unknown(),
})
const OldCaseSchema = z.object({ id: z.string(), turns: z.array(OldTurnSchema) })

export async function calibrate(
  world: EvalWorld,
  judge: Llm,
  labelsFile: string,
  casesDir: string,
  concurrency: number,
): Promise<string> {
  const { runs } = LabelsSchema.parse(JSON.parse(fs.readFileSync(labelsFile, 'utf8')))
  const cases = new Map(loadCases(world.db, casesDir).map(each => [each.id, each]))
  // Old results name songs by `title · artist · album`; back to ids, and to the judge's words.
  const byLabel = new Map(
    (
      world.db.prepare('SELECT id, title, artist, album FROM songs').all() as {
        id: number
        title: string
        artist: string
        album: string
      }[]
    ).map(row => [`${row.title} · ${row.artist} · ${row.album}`, row.id]),
  )
  const jobs = runs.flatMap(run =>
    fs
      .readFileSync(path.resolve(path.dirname(labelsFile), run.out), 'utf8')
      .split('\n')
      .filter(line => line.trim())
      .map(line => OldCaseSchema.parse(JSON.parse(line)))
      .filter(old => old.turns.some((_, at) => run.labels[`${old.id}#${at + 1}`]))
      .filter(old => !run.only || run.only.includes(old.id))
      .map(old => ({ run, old })),
  )
  // Verdicts already given by this same judge, so a calibration stopped half way picks up there.
  const cacheFile = `${labelsFile}.verdicts.json`
  const cache = (
    fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {}
  ) as Record<string, JudgedTurn[]>
  const rows: {
    run: string
    key: string
    label: string
    pass: boolean
    score: number
    problems: readonly string[]
  }[] = []
  let next = 0
  const worker = async () => {
    while (next < jobs.length) {
      const { run, old } = jobs[next++]!
      const each = cases.get(old.id)
      const turns: TurnToJudge[] = old.turns.map((turn, at) => {
        const now = each?.turns[at]
        const answer = turn.status === 200 ? oldAnswer(turn.answer, byLabel) : null
        return {
          asked: turn.asked,
          playing: now?.playing ? world.song(songNamed(world.db, now.playing)) : null,
          screen: at > 0 && now?.screen !== 'none' ? 'the songs of the answer before' : null,
          meant: now?.judge ?? null,
          answer: answer
            ? replyWords(answer, world.song)
            : `(failed: ${JSON.stringify(turn.answer)})`,
        }
      })
      const key = `${run.name}:${old.id}:${JUDGE_VERSION()}:${sha256(JSON.stringify(turns)).slice(0, 8)}`
      const verdicts = cache[key] ?? (await judgeConversation(judge, turns))
      cache[key] = verdicts
      fs.writeFileSync(cacheFile, JSON.stringify(cache))
      for (const [at, verdict] of verdicts.entries()) {
        const key = `${old.id}#${at + 1}`
        const label = run.labels[key]
        if (label) rows.push({ run: run.name, key, label, ...verdict })
      }
      console.error(`${run.name} ${old.id} judged`)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker))

  const agree = rows.filter(row => row.pass === (row.label === 'P'))
  const lines = [
    `# Judge calibration: ${agree.length}/${rows.length} agree (${Math.round((agree.length / Math.max(1, rows.length)) * 100)}%)`,
    '',
    '| person | judge pass | judge fail | mean score |',
    '|---|---|---|---|',
  ]
  for (const label of ['P', '~', 'F']) {
    const these = rows.filter(row => row.label === label)
    lines.push(
      `| ${label} | ${these.filter(row => row.pass).length} | ${these.filter(row => !row.pass).length} | ${(these.reduce((sum, row) => sum + row.score, 0) / Math.max(1, these.length)).toFixed(2)} |`,
    )
  }
  lines.push('', '## Disagreements', '')
  for (const row of rows
    .filter(each => !agree.includes(each))
    .sort((a, b) => a.key.localeCompare(b.key)))
    lines.push(
      `- ${row.run} ${row.key}: person ${row.label}, judge ${row.score} — ${row.problems.join(' ') || 'no problems named'}`,
    )
  return lines.join('\n') + '\n'
}

/**
 * An old runner's answer as a reply again: one card, its songs back to ids (a
 * song since renamed gets an id no song has, and reads as missing), the parts
 * older answers did not have yet filled in, and the `none` answer that
 * replies have no more as the words it said.
 */
function oldAnswer(answer: unknown, byLabel: ReadonlyMap<string, number>): AskReply {
  const id = (value: unknown): unknown =>
    typeof value === 'string' ? (byLabel.get(value) ?? -1) : value
  const card = JSON.parse(JSON.stringify(answer), (key, value: unknown) => {
    if (key === 'songId' || key === 'keep' || key === 'like') return id(value)
    if (key === 'songIds' && Array.isArray(value)) return value.map(id)
    if (value !== null && typeof value === 'object' && 'picks' in value && 'understanding' in value)
      return { fit: 0, loosened: [], unknown: [], notes: [], ...value }
    if (value !== null && typeof value === 'object' && 'kind' in value && value.kind === 'library')
      return { judged: null, distinct: null, ...value }
    if (value !== null && typeof value === 'object' && 'kind' in value && value.kind === 'songs')
      return { like: null, ...value }
    if (value !== null && typeof value === 'object' && 'kind' in value && value.kind === 'none') {
      const { say, try: instead } = value as unknown as { say: string; try?: string[] }
      const tried = instead?.length ? `\nSuggests: ${instead.join(' | ')}` : ''
      return { kind: 'explore', say: `Says it can't: ${say}${tried}`, songIds: [], get: null }
    }
    return value
  }) as AskReply['cards'][number]
  return { say: null, cards: [card] }
}
