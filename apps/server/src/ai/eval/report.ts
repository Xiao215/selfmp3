import fs from 'node:fs'
import type { AskReply } from '@selfmp3/shared'
import type { Check } from './checks.js'
import type { JudgedTurn } from './judge.js'

/**
 * The eval's results and what they come to: one line per case and run in a
 * `.jsonl` file named for its date, commit and models, a summary a person
 * reads (pass by class and by check, latency, model calls, judge score), and
 * how it moved from an earlier file, regressions first.
 */

export interface Call {
  readonly task: string
  readonly ms: number
  readonly ok: boolean
}

export interface TurnResult {
  readonly text: string
  readonly playing: number | null
  readonly screen: string | null
  readonly ms: number
  readonly calls: readonly Call[]
  /** Why there was no answer, when there was none. */
  readonly error: string | null
  readonly kinds: readonly string[]
  readonly answer: AskReply | null
  /** The answer as the judge read it. */
  readonly words: string
  readonly checks: readonly Check[]
  readonly judge: JudgedTurn | null
}

export interface CaseResult {
  readonly id: string
  readonly class: string
  /** Which repeat, 1 the first. */
  readonly run: number
  readonly turns: readonly TurnResult[]
}

/** What a results file was made with: its first line. */
export interface RunHeader {
  readonly date: string
  readonly sha: string
  readonly config: string
  readonly fast: string
  readonly smart: string
  readonly judge: string | null
  readonly db: string
}

/** A turn passes its checks when every one does, and passes when the judge agrees too. */
const codePass = (turn: TurnResult): boolean => turn.checks.every(check => check.pass)
const passes = (turn: TurnResult): boolean => codePass(turn) && (turn.judge?.pass ?? true)

export function writeResults(
  file: string,
  header: RunHeader,
  results: readonly CaseResult[],
): void {
  fs.writeFileSync(
    file,
    [JSON.stringify({ header }), ...results.map(result => JSON.stringify(result))].join('\n') +
      '\n',
  )
}

export function readResults(file: string): { header: RunHeader; results: CaseResult[] } {
  const [first, ...rest] = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(line => line.trim())
  const { header } = JSON.parse(first ?? '{}') as { header: RunHeader }
  return { header, results: rest.map(line => JSON.parse(line) as CaseResult) }
}

/** The summary, in Markdown. */
export function summarize(header: RunHeader, results: readonly CaseResult[]): string {
  const turns = results.flatMap(result =>
    result.turns.map(turn => ({ ...turn, class: result.class })),
  )
  const judged = turns.filter(turn => turn.judge !== null)
  const lines = [
    `# Ask eval ${header.date} · ${header.sha} · ${header.config}`,
    '',
    `${results.length} conversations, ${turns.length} turns · fast ${header.fast}, smart ${header.smart}, judge ${header.judge ?? 'none'}`,
    '',
    '| class | turns | checks pass | judge pass | both | judge score |',
    '|---|---|---|---|---|---|',
  ]
  const classes = [...new Set(turns.map(turn => turn.class))].sort()
  const row = (name: string, these: typeof turns) => {
    const scored = these.filter(turn => turn.judge !== null)
    lines.push(
      `| ${name} | ${these.length} | ${share(these.filter(codePass).length, these.length)} | ${
        scored.length ? share(scored.filter(turn => turn.judge!.pass).length, scored.length) : '–'
      } | ${share(these.filter(passes).length, these.length)} | ${
        scored.length ? mean(scored.map(turn => turn.judge!.score)).toFixed(2) : '–'
      } |`,
    )
  }
  for (const name of classes)
    row(
      name,
      turns.filter(turn => turn.class === name),
    )
  row('**all**', turns)

  lines.push('', '| check | failed | of |', '|---|---|---|')
  const checks = new Map<string, { failed: number; of: number }>()
  for (const check of turns.flatMap(turn => turn.checks)) {
    const name = check.name.startsWith('value:') ? 'value' : check.name
    const count = checks.get(name) ?? { failed: 0, of: 0 }
    count.of++
    if (!check.pass) count.failed++
    checks.set(name, count)
  }
  for (const [name, count] of [...checks].sort((a, b) => b[1].failed - a[1].failed))
    lines.push(`| ${name} | ${count.failed} | ${count.of} |`)

  const ms = turns.map(turn => turn.ms)
  const calls = turns.map(turn => turn.calls.length)
  const failedCalls = turns.flatMap(turn => turn.calls).filter(call => !call.ok).length
  lines.push(
    '',
    `Latency per turn: p50 ${seconds(quantile(ms, 0.5))}, p95 ${seconds(quantile(ms, 0.95))}, max ${seconds(Math.max(0, ...ms))}. Model calls per turn: mean ${mean(calls).toFixed(1)}, max ${Math.max(0, ...calls)}; ${failedCalls} failed. ${turns.filter(turn => turn.error !== null).length} turns without an answer.`,
  )
  if (judged.length)
    lines.push(
      `Judge: ${share(judged.filter(turn => turn.judge!.pass).length, judged.length)} pass, mean score ${mean(judged.map(turn => turn.judge!.score)).toFixed(2)}.`,
    )

  lines.push('', '| task | calls | mean | p95 | failed |', '|---|---|---|---|---|')
  const tasks = new Map<string, Call[]>()
  for (const call of turns.flatMap(turn => turn.calls))
    tasks.set(call.task, [...(tasks.get(call.task) ?? []), call])
  for (const [task, each] of [...tasks].sort((a, b) => b[1].length - a[1].length)) {
    const taken = each.map(call => call.ms)
    lines.push(
      `| ${task} | ${each.length} | ${seconds(mean(taken))} | ${seconds(quantile(taken, 0.95))} | ${each.filter(call => !call.ok).length} |`,
    )
  }

  lines.push('', '## Turns that did not pass', '')
  for (const result of results)
    for (const [at, turn] of result.turns.entries()) {
      if (passes(turn)) continue
      const why = [
        ...turn.checks.filter(check => !check.pass).map(check => `${check.name}: ${check.detail}`),
        ...(turn.judge && !turn.judge.pass
          ? [`judge ${turn.judge.score}: ${turn.judge.problems.join(' ')}`]
          : []),
      ]
      lines.push(
        `- ${result.id}#${at + 1}${result.run > 1 ? ` (run ${result.run})` : ''} “${turn.text}” — ${why.join(' · ')}`,
      )
    }
  return lines.join('\n') + '\n'
}

/**
 * How a run moved from an earlier one, turn by turn: what passed before and
 * fails now first, then what fails before and passes now, then judge scores
 * that moved by a point or more. A turn asked several times counts by its
 * share of passes.
 */
export function diff(before: readonly CaseResult[], after: readonly CaseResult[]): string {
  const byTurn = (results: readonly CaseResult[]) => {
    const turns = new Map<string, { text: string; pass: number[]; score: number[] }>()
    for (const result of results)
      for (const [at, turn] of result.turns.entries()) {
        const key = `${result.id}#${at + 1}`
        const entry = turns.get(key) ?? { text: turn.text, pass: [], score: [] }
        entry.pass.push(passes(turn) ? 1 : 0)
        if (turn.judge) entry.score.push(turn.judge.score)
        turns.set(key, entry)
      }
    return turns
  }
  const was = byTurn(before)
  const now = byTurn(after)
  const regressed: string[] = []
  const fixed: string[] = []
  const scores: string[] = []
  for (const [key, entry] of now) {
    const old = was.get(key)
    if (!old) continue
    const from = mean(old.pass)
    const to = mean(entry.pass)
    const line = `- ${key} “${entry.text}”: ${share(Math.round(from * old.pass.length), old.pass.length)} → ${share(Math.round(to * entry.pass.length), entry.pass.length)}`
    if (to < from) regressed.push(line)
    else if (to > from) fixed.push(line)
    if (old.score.length && entry.score.length) {
      const moved = mean(entry.score) - mean(old.score)
      if (Math.abs(moved) >= 1)
        scores.push(
          `- ${key}: judge ${mean(old.score).toFixed(1)} → ${mean(entry.score).toFixed(1)}`,
        )
    }
  }
  const only = (a: Map<string, unknown>, b: Map<string, unknown>) =>
    [...a.keys()].filter(key => !b.has(key))
  return (
    [
      `## Against the earlier run`,
      '',
      `Regressions (${regressed.length}):`,
      ...regressed,
      '',
      `Fixed (${fixed.length}):`,
      ...fixed,
      '',
      `Judge scores that moved (${scores.length}):`,
      ...scores,
      '',
      `New turns: ${only(now, was).join(', ') || 'none'} · gone: ${only(was, now).join(', ') || 'none'}`,
    ].join('\n') + '\n'
  )
}

function share(n: number, of: number): string {
  return of === 0 ? '–' : `${n}/${of} (${Math.round((n / of) * 100)}%)`
}

function mean(values: readonly number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]!
}

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`
