import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { migrate } from '../../db/migrate.js'
import { createLogger } from '../../logger.js'
import { endpointLlm } from '../fixtures/library.js'
import { loadCases } from './cases.js'
import { diff, summarize, type CaseResult } from './report.js'
import { evalWorld, runCases } from './run.js'

/**
 * The harness itself, offline: the made-up cases beside it run against a
 * scripted model behind a fake endpoint, over a database built from the real
 * schema, so replaying, checking, judging and reporting are tested together.
 */

const EXAMPLE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'example.cases.json')

const NO_FILTERS = {
  name: 'Aurora Lane',
  anyTags: [],
  artists: [],
  albums: [],
  noTags: [],
  energy: { min: null, max: null },
  bpm: { min: null, max: null },
  year: { min: null, max: null },
  words: null,
  loved: null,
  playedWithinDays: null,
  notPlayedWithinDays: null,
  addedWithinDays: null,
  size: null,
  minutes: null,
  sound: null,
  brief: null,
}

const route = (overrides: Record<string, unknown>) => ({
  action: 'none',
  filters: null,
  songs: null,
  change: null,
  reply: null,
  tags: null,
  playback: null,
  find: null,
  stats: null,
  playlists: null,
  playlistSongs: null,
  library: null,
  tidy: null,
  remember: null,
  getMusic: null,
  open: null,
  say: null,
  try: null,
  ...overrides,
})

function library(): Database.Database {
  const db = new Database(':memory:')
  migrate(db, createLogger('silent'))
  db.exec(`
    INSERT INTO songs (id, path, title, artist, album, duration) VALUES
      (1, 'a.m4a', 'Dawn', 'Aurora Lane', 'Night', 200),
      (2, 'b.m4a', 'Dusk', 'Aurora Lane', 'Night', 220),
      (3, 'c.m4a', 'Rain', 'Someone Else', 'Weather', 180);
    INSERT INTO tags (id, name) VALUES (1, 'calm');
    INSERT INTO song_tags (song_id, tag_id) VALUES (1, 1), (2, 1);
  `)
  return db
}

function world(replies: Record<string, unknown[]>) {
  const llm = endpointLlm(replies)
  const db = library()
  return {
    llm,
    world: evalWorld({
      db,
      config: {
        ai: {
          baseUrl: null,
          apiKey: '',
          modelFast: 'fast',
          modelSmart: 'smart',
          timeoutSeconds: 5,
        },
      },
      logger: createLogger('silent'),
      llm,
      netease: {
        search: () => Promise.resolve([]),
        searchAlbums: () => Promise.resolve([]),
        albumTracks: () => Promise.resolve(null),
      },
      lookup: { lookup: () => Promise.resolve([]) },
    }),
  }
}

/** Fresh each time: the endpoint takes its replies off the lists. */
const script = () => ({
  'ask-route': [
    route({
      action: 'library',
      filters: { ...NO_FILTERS, artists: ['Aurora Lane'] },
      library: { from: null, show: 'count', sortBy: null, order: 'asc' },
    }),
    route({ action: 'playback', playback: { op: 'next', place: null } }),
    route({ action: 'playback', playback: { op: 'next', place: null } }),
  ],
})

describe('the eval harness', () => {
  it('replays each conversation the way the app sends it, and checks every answer in code', async () => {
    const { llm, world: here } = world(script())
    const cases = loadCases(here.db, EXAMPLE)
    // One at a time, so the scripted replies are taken in the cases' order.
    const results = await runCases(here, cases, { concurrency: 1 })
    expect(results.map(result => result.id)).toEqual(['ex-count', 'ex-skip'])
    const [count, skip] = results
    expect(count!.turns[0]).toMatchObject({ kinds: ['library'], error: null })
    expect(count!.turns[0]!.calls.map(call => call.task)).toEqual(['ask-route'])
    expect(count!.turns[0]!.checks.every(check => check.pass)).toBe(true)
    expect(count!.turns[0]!.checks.map(check => check.name)).toEqual(
      expect.arrayContaining(['cards', 'value:count', 'where', 'maxCalls']),
    )
    expect(skip!.turns.map(turn => turn.kinds)).toEqual([['playback'], ['playback']])
    // The song playing is found by its title; the follow-up is asked after the first turn.
    expect(skip!.turns[0]!.playing).toBe(3)
    expect(llm.prompts['ask-route']![2]).toContain('skip this one')
  })

  it('fails a check that does not hold, and has the judge read each turn as text', async () => {
    // The judge's replies come from the same scripted endpoint as the rest.
    const { llm, world: here } = world({
      ...script(),
      'eval-judge': [
        { turns: [{ turn: 1, problems: [], score: 5, pass: true }] },
        {
          turns: [
            { turn: 1, problems: [], score: 4, pass: true },
            { turn: 2, problems: ['Skipped twice.'], score: 3, pass: true },
          ],
        },
      ],
    })
    const [first, second] = loadCases(here.db, EXAMPLE)
    const wrong = {
      ...first!,
      turns: [{ ...first!.turns[0]!, expect: { cards: ['songs'], card: [{ count: 3 }] } }],
    }
    const results = await runCases(here, [wrong, second!], { concurrency: 1, judge: llm })
    expect(
      results[0]!.turns[0]!.checks.filter(check => !check.pass).map(check => check.name),
    ).toEqual(['cards', 'count'])
    expect(results[0]!.turns[0]!.judge).toEqual({ pass: true, score: 5, problems: [] })
    // A pass with a 3 is the judge contradicting itself: the score decides.
    expect(results[1]!.turns[1]!.judge).toEqual({
      pass: false,
      score: 3,
      problems: ['Skipped twice.'],
    })
    expect(llm.prompts['eval-judge']![1]).toContain('Playing: Rain · Someone Else · Weather')
  })

  it('sums a run up by class and check, and puts what got worse first', () => {
    const turn = (pass: boolean) => ({
      text: 'skip',
      playing: null,
      screen: null,
      ms: 1000,
      calls: [{ task: 'ask-route', ms: 900, ok: true }],
      error: null,
      kinds: ['playback'],
      answer: null,
      words: '',
      checks: [{ name: 'op', pass, detail: '' }],
      judge: { pass, score: pass ? 5 : 2, problems: [] },
    })
    const run = (pass: boolean): CaseResult[] => [
      { id: 'a', class: 'playback', run: 1, turns: [turn(pass)] },
    ]
    const header = {
      date: '2026-10-27',
      sha: 'abc',
      config: 'x',
      fast: 'f',
      smart: 's',
      judge: 'j',
      db: 'd',
    }
    const summary = summarize(header, run(false))
    expect(summary).toContain('| playback | 1 | 0/1 (0%) | 0/1 (0%) | 0/1 (0%) | 2.00 |')
    expect(summary).toContain('| op | 1 | 1 |')
    expect(summary).toContain('p50 1.0 s')
    const moved = diff(run(true), run(false))
    expect(moved.indexOf('Regressions (1)')).toBeLessThan(moved.indexOf('Fixed (0)'))
    expect(moved).toContain('- a#1 “skip”: 1/1 (100%) → 0/1 (0%)')
  })
})
