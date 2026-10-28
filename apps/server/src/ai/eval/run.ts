import { AsyncLocalStorage } from 'node:async_hooks'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import type Database from 'better-sqlite3'
import {
  answerRecap,
  beforeTurn,
  joinedNames,
  messageOf,
  objectsOf,
  type AskObject,
} from '@selfmp3/shared'
import { loadConfig, type Config } from '../../config.js'
import { openDatabase } from '../../db/index.js'
import { createLogger, type Logger } from '../../logger.js'
import { LyricsSearchRepository } from '../../repositories/lyricsSearch.js'
import { NamesRepository } from '../../repositories/names.js'
import { PlaylistRepository } from '../../repositories/playlists.js'
import { SettingsRepository } from '../../repositories/settings.js'
import { SongRepository } from '../../repositories/songs.js'
import { SoundVectorsRepository } from '../../repositories/soundVectors.js'
import { StatsRepository } from '../../repositories/stats.js'
import { TagRepository } from '../../repositories/tags.js'
import { WrappedRepository } from '../../repositories/wrapped.js'
import { MetadataLookupService } from '../../services/lookup.js'
import { NeteaseMusic } from '../../services/netease.js'
import { SoundService } from '../../sound/sound.js'
import { openAiCompatible, type Llm } from '../llm.js'
import { llmFor, smartFeaturesFor, type SmartFeatures } from '../smart.js'
import { calibrate } from './calibrate.js'
import { loadCases, songNamed, type EvalCase } from './cases.js'
import { cardsOf, checkTurn, withEvalFunctions } from './checks.js'
import { answerWords, judgeConversation, type SongWords, type TurnToJudge } from './judge.js'
import { one } from './one.js'
import {
  diff,
  readResults,
  summarize,
  writeResults,
  type Call,
  type CaseResult,
  type RunHeader,
  type TurnResult,
} from './report.js'

/**
 * Ask's eval harness (docs/features/ai.md, "Testing"; AGENT-DESIGN 4): asks
 * the real model a set of conversations about a fresh copy of a real
 * library, in process and wired the way the server runs (`smartFeaturesFor`),
 * replays every follow-up the way the app sends it (earlier turns with their
 * objects, the answer on the screen), checks each answer in code, has a
 * judge read it, and writes what came of it beside the cases.
 *
 *   npx tsx apps/server/src/ai/eval/run.ts --fast sonnet --smart sonnet --judge opus
 *   … --only s-jaychou,m-yoasobi --repeat 3 --concurrency 2
 *   … --one describe "calm piano for reading"      (also ask, tags, tidy, written, import)
 *   … --judge opus --calibrate ~/ask-eval-selfmp3/cases/labels.json
 *
 * The cases (`--cases`, a folder or a file) and the database (`--db`) stay
 * outside the repository: they are a person's library. The database is
 * copied to a temporary folder and migrated there; the original is only read.
 * Answered questions are not remembered between turns, so a question asked
 * again is answered again. Nothing is applied: proposals stay proposals.
 */

/* eslint-disable no-console -- a script's output is its console. */

const HOME = os.homedir()
const DEFAULTS = {
  db: path.join(HOME, 'ask-eval-selfmp3/prod.pristine.db'),
  cases: path.join(HOME, 'ask-eval-selfmp3/cases'),
  out: path.join(HOME, 'ask-eval-selfmp3/results'),
  endpoint: 'http://127.0.0.1:8797/v1',
  models: path.join(HOME, 'Library/Application Support/selfmp3-dev/models'),
}

/** The calls of the turn under way, whichever conversation it is in. */
const turnCalls = new AsyncLocalStorage<Call[]>()

/** A model whose every call is counted against the turn that made it. */
function watched(llm: Llm): Llm {
  return {
    generate: async request => {
      const started = Date.now()
      const note = (ok: boolean) =>
        turnCalls.getStore()?.push({ task: request.task, ms: Date.now() - started, ok })
      try {
        const answer = await llm.generate(request)
        note(true)
        return answer
      } catch (error) {
        note(false)
        throw error
      }
    },
  }
}

/** A library copy and the smart features over it. */
export interface EvalWorld {
  readonly db: Database.Database
  readonly smart: SmartFeatures
  readonly song: SongWords
}

export function evalWorld(sources: {
  readonly db: Database.Database
  readonly config: Pick<Config, 'ai'>
  readonly logger: Logger
  readonly llm: Llm
  readonly netease: Pick<NeteaseMusic, 'search' | 'searchAlbums' | 'albumTracks'>
  readonly lookup: Pick<MetadataLookupService, 'lookup'>
  readonly sound?: SoundService
}): EvalWorld {
  const db = withEvalFunctions(sources.db)
  const songs = new SongRepository(db)
  const names = new NamesRepository(db)
  const shownAs = (): ReadonlyMap<string, string> => joinedNames(songs.all(), names.joinNames())
  const smart = smartFeaturesFor({
    config: sources.config,
    logger: sources.logger,
    songs,
    tags: new TagRepository(db),
    names,
    sound: sources.sound,
    stats: new StatsRepository(db, shownAs),
    wrapped: new WrappedRepository(db, shownAs),
    playlists: new PlaylistRepository(db),
    lyricsSearch: new LyricsSearchRepository(db),
    settings: new SettingsRepository(db),
    netease: sources.netease,
    lookup: sources.lookup,
    llm: watched(sources.llm),
    remember: false,
  })
  const row = db.prepare(
    `SELECT s.title, s.artist, s.album, (SELECT group_concat(t.name, ', ') FROM song_tags st JOIN tags t ON t.id = st.tag_id WHERE st.song_id = s.id) AS tags FROM songs s WHERE s.id = ?`,
  )
  const song: SongWords = id => {
    const found = row.get(id) as
      { title: string; artist: string; album: string; tags: string | null } | undefined
    if (!found) return `#${id} (no such song)`
    return [found.title, found.artist, found.album, found.tags ? `[${found.tags}]` : null]
      .filter(Boolean)
      .join(' · ')
  }
  return { db, smart, song }
}

/** Each case `repeat` times, `concurrency` conversations at once, judged when there is a judge. */
export async function runCases(
  world: EvalWorld,
  cases: readonly EvalCase[],
  options: {
    readonly repeat?: number
    readonly concurrency?: number
    readonly judge?: Llm | null
    readonly done?: (result: CaseResult) => void
  } = {},
): Promise<CaseResult[]> {
  const jobs = cases.flatMap(each =>
    Array.from({ length: options.repeat ?? 1 }, (_, at) => ({ each, run: at + 1 })),
  )
  const results: CaseResult[] = []
  let next = 0
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++]!
      const result = await conversation(world, job.each, job.run, options.judge ?? null)
      results.push(result)
      options.done?.(result)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, options.concurrency ?? 2) }, worker))
  const order = new Map(jobs.map((job, at) => [`${job.each.id}#${job.run}`, at]))
  return results.sort((a, b) => order.get(`${a.id}#${a.run}`)! - order.get(`${b.id}#${b.run}`)!)
}

/** What a failed turn's answer is told back as, as the app tells it. */
const NOT_ANSWERED = '(This could not be answered.)'

async function conversation(
  world: EvalWorld,
  each: EvalCase,
  run: number,
  judge: Llm | null,
): Promise<CaseResult> {
  const { db, smart, song } = world
  const asked: { asked: string; answered: string; outcome: null; objects: AskObject[] }[] = []
  const turns: TurnResult[] = []
  for (const [at, turn] of each.turns.entries()) {
    const playing = turn.playing === undefined ? null : songNamed(db, turn.playing)
    const wanted = turn.screen ?? (at === 0 ? 'none' : 'previous')
    const screen =
      wanted === 'none'
        ? null
        : wanted === 'previous'
          ? (asked.findLast(earlier => earlier.objects.length > 0)?.objects[0]?.handle ?? null)
          : wanted
    const onScreen = asked
      .flatMap(earlier => earlier.objects)
      .find(object => object.handle === screen)
    const calls: Call[] = []
    const started = Date.now()
    let answer = null
    let error: string | null = null
    try {
      answer = await turnCalls.run(calls, () =>
        smart.ask(
          turn.text,
          { playing, screen },
          undefined,
          beforeTurn(asked, asked.length, screen),
        ),
      )
    } catch (failed) {
      error = messageOf(failed)
    }
    const ms = Date.now() - started
    asked.push({
      asked: turn.text,
      answered: answer ? answerRecap(answer) : NOT_ANSWERED,
      outcome: null,
      objects: answer ? objectsOf(answer, at + 1) : [],
    })
    const cards = answer ? cardsOf(answer) : []
    const words = answer ? answerWords(answer, song) : `(failed: ${error})`
    turns.push({
      text: turn.text,
      playing,
      screen,
      ms,
      calls,
      error,
      kinds: cards.map(card => card.kind),
      answer,
      words,
      checks: checkTurn(db, turn.expect, {
        cards,
        error,
        ms,
        calls: calls.length,
        playing,
        screen: onScreen?.songIds ?? null,
        words: card => answerWords(card.answer, song),
      }),
      judge: null,
    })
  }
  if (!judge) return { id: each.id, class: each.class, run, turns }
  const toJudge: TurnToJudge[] = turns.map((turn, at) => ({
    asked: turn.text,
    playing: turn.playing === null ? null : song(turn.playing),
    screen: turn.screen
      ? `the songs of ${turn.screen} (turn ${turn.screen.slice(1).split('.')[0]})`
      : null,
    meant: each.turns[at]?.judge ?? null,
    answer: turn.words,
  }))
  try {
    const verdicts = await judgeConversation(judge, toJudge)
    return {
      id: each.id,
      class: each.class,
      run,
      turns: turns.map((turn, at) => ({ ...turn, judge: verdicts[at] ?? null })),
    }
  } catch (failed) {
    console.error(`${each.id}: the judge failed: ${messageOf(failed)}`)
    return { id: each.id, class: each.class, run, turns }
  }
}

/** The judge: the same endpoint, another model. */
function judgeLlm(endpoint: string, model: string, logger: Logger): Llm {
  return openAiCompatible(
    { baseUrl: endpoint, apiKey: null, models: { fast: model, smart: model }, timeoutMs: 300_000 },
    { logger },
  )
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      db: { type: 'string', default: DEFAULTS.db },
      cases: { type: 'string', default: DEFAULTS.cases },
      out: { type: 'string', default: DEFAULTS.out },
      endpoint: {
        type: 'string',
        default: process.env['SELFMP3_AI_BASE_URL'] || DEFAULTS.endpoint,
      },
      fast: { type: 'string', default: 'sonnet' },
      smart: { type: 'string', default: 'sonnet' },
      judge: { type: 'string' },
      repeat: { type: 'string', default: '1' },
      only: { type: 'string' },
      class: { type: 'string' },
      concurrency: { type: 'string', default: '2' },
      against: { type: 'string' },
      models: { type: 'string', default: DEFAULTS.models },
      'no-sound': { type: 'boolean', default: false },
      one: { type: 'string' },
      calibrate: { type: 'string' },
    },
  })
  // A fresh copy for every run, migrated to this checkout's schema; the original is only read.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-eval-'))
  fs.copyFileSync(values.db, path.join(dir, 'selfmp3.db'))
  // The original is kept read-only on disk, and a copy keeps its mode.
  fs.chmodSync(path.join(dir, 'selfmp3.db'), 0o644)
  const sound = !values['no-sound'] && fs.existsSync(values.models)
  if (sound) fs.symlinkSync(values.models, path.join(dir, 'models'))
  Object.assign(process.env, {
    SELFMP3_DATA_DIR: dir,
    SELFMP3_LIBRARY_DIR: path.join(dir, 'library'),
    SELFMP3_AI_BASE_URL: values.endpoint,
    SELFMP3_AI_MODEL_FAST: values.fast,
    SELFMP3_AI_MODEL_SMART: values.smart,
    SELFMP3_SOUND: String(sound),
  })
  const config = loadConfig()
  const logger = createLogger('warn')
  const db = openDatabase(config, logger)
  const listening = sound
    ? new SoundService({ config, vectors: new SoundVectorsRepository(db), logger })
    : undefined
  const world = evalWorld({
    db,
    config,
    logger,
    llm: llmFor(config, logger),
    netease: new NeteaseMusic(logger),
    lookup: new MetadataLookupService(logger),
    sound: listening,
  })
  const judge = values.judge ? judgeLlm(values.endpoint, values.judge, logger) : null
  try {
    if (values.one) {
      await one(world, values.one, positionals)
      return
    }
    if (values.calibrate) {
      if (!judge) throw new Error('--calibrate needs --judge')
      console.log(
        await calibrate(world, judge, values.calibrate, values.cases, Number(values.concurrency)),
      )
      return
    }
    const only = values.only ? new Set(values.only.split(',')) : null
    const classes = values.class ? new Set(values.class.split(',')) : null
    const cases = loadCases(db, values.cases).filter(
      each => (!only || only.has(each.id)) && (!classes || classes.has(each.class)),
    )
    const turns = cases.reduce((sum, each) => sum + each.turns.length, 0) * Number(values.repeat)
    console.error(
      `${cases.length} cases, ${turns} turns; fast ${values.fast}, smart ${values.smart}, judge ${values.judge ?? 'none'}, sound ${sound ? 'on' : 'off'}`,
    )
    const results = await runCases(world, cases, {
      repeat: Number(values.repeat),
      concurrency: Number(values.concurrency),
      judge,
      done: result => {
        for (const [at, turn] of result.turns.entries()) {
          const failed = turn.checks.filter(check => !check.pass).map(check => check.name)
          console.error(
            `${result.id}#${at + 1} ${turn.kinds.join(',') || 'error'} ${turn.ms} ms ${turn.calls.length} calls ${failed.length ? `✗ ${failed.join(',')}` : '✓'}${turn.judge ? ` judge ${turn.judge.score}` : ''}`,
          )
        }
      },
    })
    const header: RunHeader = {
      date: new Date().toISOString().slice(0, 10),
      sha: commit(),
      config: `fast-${values.fast}.smart-${values.smart}`,
      fast: values.fast,
      smart: values.smart,
      judge: values.judge ?? null,
      db: values.db,
    }
    fs.mkdirSync(values.out, { recursive: true })
    const file = path.join(values.out, `${header.date}-${header.sha}-${header.config}.jsonl`)
    const against = values.against ?? earlier(values.out, header.config, file)
    writeResults(file, header, results)
    let summary = summarize(header, results)
    if (against)
      summary += `\n${diff(readResults(against).results, results)}\n(against ${against})\n`
    fs.writeFileSync(file.replace(/\.jsonl$/, '.md'), summary)
    console.log(summary)
    console.log(`Results: ${file}`)
  } finally {
    await listening?.close()
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/** This checkout's commit, marked when it has changes not committed. */
function commit(): string {
  const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim()
  try {
    return `${git('rev-parse', '--short', 'HEAD')}${git('status', '--porcelain') ? '+' : ''}`
  } catch {
    return 'nogit'
  }
}

/** The newest earlier results with the same models, to diff against. */
function earlier(dir: string, config: string, not: string): string | null {
  const files = fs
    .readdirSync(dir)
    .filter(name => name.endsWith(`-${config}.jsonl`))
    .map(name => path.join(dir, name))
    .filter(file => file !== not)
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  return files[0] ?? null
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    () => process.exit(0),
    (error: unknown) => {
      console.error(error)
      process.exit(1)
    },
  )
}
