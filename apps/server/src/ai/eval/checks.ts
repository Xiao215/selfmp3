import type Database from 'better-sqlite3'
import { z } from 'zod'
import { detectScript, type AskCard, type AskReply } from '@selfmp3/shared'

/**
 * What a turn of an eval case expects, and the checks that hold an answer to
 * it in code (AGENT-DESIGN 4). Whatever can be counted is: kinds, how many
 * songs and minutes, the share of them a SQL condition over the library copy
 * lets in, an exact count the database gives, names, order, a follow-up
 * acting on what it pointed at. The judge (`judge.ts`) is for the rest.
 */

const RangeSchema = z.object({ min: z.number().optional(), max: z.number().optional() })

const CardExpectSchema = z
  .object({
    /** Songs on the card, or a library answer's count: exactly, or a range. */
    count: z.union([z.number().int(), RangeSchema]).optional(),
    minutes: RangeSchema.optional(),
    /** A SQL condition over `songs` (one row, `id` its id) most of its songs meet... */
    where: z.string().optional(),
    /** ...this share of them, 1 by default. */
    atLeast: z.number().min(0).max(1).optional(),
    /** At least one of its songs meets this. */
    some: z.string().optional(),
    /** Its first song meets this: "play it" plays the best one. */
    first: z.string().optional(),
    /** Exactly the songs `select id from songs where <same>` gives, as a set. */
    same: z.string().optional(),
    /** In this order by a SQL expression over `songs`. */
    order: z.object({ by: z.string(), dir: z.enum(['asc', 'desc']) }).optional(),
    /** Numbers in the answer (`count`, `distinct.albums`, `plays`) equal to a SQL query's one value. */
    value: z
      .array(z.object({ path: z.string(), sql: z.string(), within: z.number().optional() }))
      .optional(),
    /** A tag change adding, or taking off, this tag. */
    tagAdd: z.string().optional(),
    tagRemove: z.string().optional(),
    /** The playlist a playlist answer names. */
    playlist: z.string().optional(),
    /** A playback, playlist or playlist-songs answer's op. */
    op: z.string().optional(),
    lead: z.enum(['play', 'save', 'next']).optional(),
    /** The song playing is on the card (`includes`), or is all of it (`only`). */
    playing: z.enum(['includes', 'only']).optional(),
    /** Its songs come from the answer on the screen: `pick` its places (1 first), else this share. */
    actsOn: z
      .object({ pick: z.array(z.number().int().min(1)).optional(), atLeast: z.number().optional() })
      .optional(),
    /** The same songs as another card of this answer, by its place (0 first). */
    sameSongsAs: z.number().int().min(0).optional(),
    /** A pattern (case-insensitive) the card's words match. */
    says: z.string().optional(),
  })
  .strict()
type CardExpect = z.infer<typeof CardExpectSchema>

export const ExpectSchema = z
  .object({
    /** The cards' kinds in order; a list is any one of them. */
    cards: z.array(z.union([z.string(), z.array(z.string())])).optional(),
    card: z.array(CardExpectSchema).optional(),
    /** Kinds that must not come; `clarify` unless `cards` names it. */
    noKinds: z.array(z.string()).optional(),
    maxMs: z.number().optional(),
    /** The most model calls the turn may make. */
    maxCalls: z.number().int().optional(),
  })
  .strict()
type Expect = z.infer<typeof ExpectSchema>

/** One card of a reply (AGENT-DESIGN 2.4), with its songs as the checks read them. */
interface Card {
  readonly kind: string
  /** Its songs, in the order shown. */
  readonly songIds: readonly number[]
  /** How many songs it is about: a library answer counts more than it lists. */
  readonly count: number
  readonly answer: AskCard
}

export function cardsOf(reply: AskReply): Card[] {
  return reply.cards.map(cardOf)
}

function cardOf(answer: AskCard): Card {
  const card = (songIds: readonly number[], count = songIds.length): Card => ({
    kind: answer.kind,
    songIds,
    count,
    answer,
  })
  const unique = (ids: readonly number[]) => [...new Set(ids)]
  switch (answer.kind) {
    case 'songs':
      return card(answer.describe.picks.map(pick => pick.songId))
    case 'together':
      return card(answer.describe?.picks.map(pick => pick.songId) ?? [])
    case 'find':
      return card(answer.picks.map(pick => pick.songId))
    case 'library':
      return card(answer.songIds, answer.count)
    case 'stats': {
      const ids = answer.items.flatMap(item => (item.songId === null ? [] : [item.songId]))
      return card(ids, answer.items.length)
    }
    case 'explore':
      return card(answer.songIds)
    case 'playlistSongs':
      return card(answer.songs.map(each => each.songId))
    case 'tags':
      return card(unique(answer.review.changes.flatMap(change => change.songIds)))
    case 'tidy':
      return card(unique(answer.tidy.changes.flatMap(change => change.songIds)))
    case 'copies':
      return card(unique(answer.copies.copies.flatMap(copy => [copy.keep, ...copy.songIds])))
    case 'remember':
    case 'getMusic':
    case 'playlists':
    case 'open':
    case 'playback':
    case 'clarify':
      return card([])
  }
}

export interface Check {
  /** What was checked, the same across turns so the report can count them: `count`, `where`. */
  readonly name: string
  readonly pass: boolean
  readonly detail: string
}

/** A turn's answer and where it was asked, as the checks read them. */
interface Answered {
  readonly cards: readonly Card[]
  /** Why there was no answer, when there was none. */
  readonly error: string | null
  readonly ms: number
  readonly calls: number
  readonly playing: number | null
  /** The songs on the screen when it was asked, in their order. */
  readonly screen: readonly number[] | null
  /** The card's words, for `says`. */
  readonly words: (card: Card) => string
}

/**
 * The library copy the expectations are written against, with what the
 * conditions need beyond SQLite: `script(text)` is the script a text is
 * written in (`kana`, `mixed` for Japanese, `han`, `latin`, shared
 * `detectScript`) and `tagged(id, name)` whether a song wears a tag. The
 * tags are read once: a function cannot query the connection running it,
 * and nothing in a run writes to the copy.
 */
export function withEvalFunctions(db: Database.Database): Database.Database {
  db.function('script', { deterministic: true }, (text: unknown) =>
    detectScript(typeof text === 'string' ? text : ''),
  )
  const tags = new Set(
    (
      db
        .prepare(
          'SELECT st.song_id AS id, t.name FROM song_tags st JOIN tags t ON t.id = st.tag_id',
        )
        .all() as { id: number; name: string }[]
    ).map(row => `${row.id}\n${row.name.toLowerCase()}`),
  )
  db.function('tagged', { deterministic: true }, (id: unknown, name: unknown) =>
    tags.has(`${String(id)}\n${String(name).toLowerCase()}`) ? 1 : 0,
  )
  return db
}

export function checkTurn(db: Database.Database, expect: Expect, answered: Answered): Check[] {
  const checks: Check[] = []
  const add = (name: string, pass: boolean, detail: string) => checks.push({ name, pass, detail })
  if (answered.error !== null) {
    add('answered', false, answered.error)
    return checks
  }
  const kinds = answered.cards.map(card => card.kind)
  if (expect.cards) {
    const fits =
      expect.cards.length === kinds.length &&
      expect.cards.every((want, at) =>
        Array.isArray(want) ? want.includes(kinds[at]!) : want === kinds[at],
      )
    add('cards', fits, `${kinds.join(', ')} (wanted ${expect.cards.map(String).join(' / ')})`)
  }
  const unwanted =
    expect.noKinds ??
    (expect.cards?.some(want => (Array.isArray(want) ? want : [want]).includes('clarify'))
      ? []
      : ['clarify'])
  const bad = kinds.filter(kind => unwanted.includes(kind))
  if (bad.length > 0) add('noKinds', false, `answered ${bad.join(', ')}`)
  if (expect.maxMs !== undefined)
    add('maxMs', answered.ms <= expect.maxMs, `${answered.ms} ms (at most ${expect.maxMs})`)
  if (expect.maxCalls !== undefined)
    add(
      'maxCalls',
      answered.calls <= expect.maxCalls,
      `${answered.calls} calls (at most ${expect.maxCalls})`,
    )
  for (const [at, want] of (expect.card ?? []).entries()) {
    const card = answered.cards[at]
    if (!card) {
      add('card', false, `no card ${at + 1}`)
      continue
    }
    checkCard(db, want, card, answered, add)
  }
  return checks
}

function checkCard(
  db: Database.Database,
  want: CardExpect,
  card: Card,
  answered: Answered,
  add: (name: string, pass: boolean, detail: string) => void,
): void {
  const ids = card.songIds
  const meeting = (where: string): Set<number> => matching(db, where, ids)
  if (want.count !== undefined) {
    const fits =
      typeof want.count === 'number'
        ? card.count === want.count
        : inRange(card.count, want.count.min, want.count.max)
    add('count', fits, `${card.count} (wanted ${rangeWords(want.count)})`)
  }
  if (want.minutes) {
    const minutes = minutesOf(db, ids)
    add(
      'minutes',
      inRange(minutes, want.minutes.min, want.minutes.max),
      `${minutes.toFixed(1)} min (wanted ${rangeWords(want.minutes)})`,
    )
  }
  if (want.where !== undefined) {
    const share = ids.length === 0 ? 0 : meeting(want.where).size / ids.length
    const atLeast = want.atLeast ?? 1
    add(
      'where',
      ids.length > 0 && share >= atLeast,
      `${Math.round(share * 100)}% of ${ids.length} meet ${want.where} (wanted ${Math.round(atLeast * 100)}%)`,
    )
  }
  if (want.some !== undefined) {
    const met = meeting(want.some).size
    add('some', met > 0, `${met} of ${ids.length} meet ${want.some}`)
  }
  if (want.first !== undefined) {
    const first = ids[0]
    const fits = first !== undefined && matching(db, want.first, [first]).size === 1
    add(
      'first',
      fits,
      `first ${first === undefined ? 'none' : nameOf(db, first)} (wanted ${want.first})`,
    )
  }
  if (want.same !== undefined) {
    const expected = (
      db.prepare(`SELECT id FROM songs WHERE ${want.same}`).all() as { id: number }[]
    ).map(row => row.id)
    const have = new Set(ids)
    const missing = expected.filter(id => !have.has(id))
    const extra = ids.filter(id => !expected.includes(id))
    add(
      'same',
      missing.length === 0 && extra.length === 0,
      `${missing.length} missing, ${extra.length} extra of ${expected.length}`,
    )
  }
  if (want.order) {
    const value = db.prepare(`SELECT ${want.order.by} AS v FROM songs WHERE id = ?`)
    const values = ids.map(id => (value.get(id) as { v: number | string | null } | undefined)?.v)
    const outOf = values.findIndex((v, at) => {
      if (at === 0) return false
      const was = values[at - 1]
      if (v === null || v === undefined || was === null || was === undefined) return false
      return want.order!.dir === 'asc' ? v < was : v > was
    })
    add(
      'order',
      ids.length > 0 && outOf === -1,
      outOf === -1 ? `in order by ${want.order.by}` : `out of order at ${outOf + 1}`,
    )
  }
  for (const each of want.value ?? []) {
    const actual = Number(pathOf(card.answer, each.path))
    const row = db.prepare(each.sql).raw().get() as unknown[] | undefined
    const expected = Number(row?.[0])
    const within = each.within ?? 0
    add(
      `value:${each.path}`,
      Math.abs(actual - expected) <= within,
      `${actual} (wanted ${expected}${within ? ` ± ${within}` : ''})`,
    )
  }
  const changes = card.answer.kind === 'tags' ? card.answer.review.changes : []
  if (want.tagAdd !== undefined) {
    const change = changes.find(each => each.op === 'add' && sameName(each.tag, want.tagAdd!))
    add(
      'tag',
      change !== undefined,
      `${changes.map(each => `${each.op} ${each.tag}`).join(', ') || 'no changes'} (wanted add ${want.tagAdd})`,
    )
  }
  if (want.tagRemove !== undefined) {
    const change = changes.find(each => each.op === 'remove' && sameName(each.tag, want.tagRemove!))
    add(
      'tag',
      change !== undefined,
      `${changes.map(each => `${each.op} ${each.tag}`).join(', ') || 'no changes'} (wanted remove ${want.tagRemove})`,
    )
  }
  if (want.playlist !== undefined) {
    const named =
      card.answer.kind === 'playlistSongs'
        ? [card.answer.playlist]
        : card.answer.kind === 'playlists'
          ? card.answer.names
          : []
    add(
      'playlist',
      named.some(name => sameName(name, want.playlist!)),
      `${named.join(', ') || 'none'} (wanted ${want.playlist})`,
    )
  }
  if (want.op !== undefined) {
    const op = 'op' in card.answer ? String(card.answer.op) : null
    add('op', op === want.op, `${op ?? 'none'} (wanted ${want.op})`)
  }
  if (want.lead !== undefined) {
    const lead = card.answer.kind === 'songs' ? card.answer.lead : null
    add('lead', lead === want.lead, `${lead ?? 'none'} (wanted ${want.lead})`)
  }
  if (want.playing !== undefined) {
    const playing = answered.playing
    const fits =
      playing !== null && ids.includes(playing) && (want.playing === 'includes' || ids.length === 1)
    add(
      'playing',
      fits,
      `${ids.length} songs, playing ${playing !== null && ids.includes(playing) ? 'in' : 'not in'} them`,
    )
  }
  if (want.actsOn) {
    const screen = answered.screen ?? []
    if (want.actsOn.pick) {
      const wanted = want.actsOn.pick.map(at => screen[at - 1])
      const fits = wanted.length === ids.length && wanted.every((id, at) => id === ids[at])
      add(
        'actsOn',
        fits,
        `${ids.map(id => nameOf(db, id)).join('; ') || 'none'} (wanted places ${want.actsOn.pick.join(', ')})`,
      )
    } else {
      const from = new Set(screen)
      const share = ids.length === 0 ? 0 : ids.filter(id => from.has(id)).length / ids.length
      const atLeast = want.actsOn.atLeast ?? 1
      add(
        'actsOn',
        ids.length > 0 && share >= atLeast,
        `${Math.round(share * 100)}% of ${ids.length} from the screen's ${screen.length}`,
      )
    }
  }
  if (want.sameSongsAs !== undefined) {
    const other = answered.cards[want.sameSongsAs]
    const fits =
      other !== undefined &&
      other.songIds.length === ids.length &&
      other.songIds.every(id => ids.includes(id))
    add('sameSongsAs', fits, other ? `${ids.length} vs ${other.songIds.length}` : 'no such card')
  }
  if (want.says !== undefined) {
    const words = answered.words(card)
    add('says', new RegExp(want.says, 'i').test(words), `wanted /${want.says}/`)
  }
}

function matching(db: Database.Database, where: string, ids: readonly number[]): Set<number> {
  if (ids.length === 0) return new Set()
  const rows = db
    .prepare(`SELECT id FROM songs WHERE id IN (SELECT value FROM json_each(?)) AND (${where})`)
    .all(JSON.stringify(ids)) as { id: number }[]
  return new Set(rows.map(row => row.id))
}

function minutesOf(db: Database.Database, ids: readonly number[]): number {
  if (ids.length === 0) return 0
  const row = db
    .prepare('SELECT SUM(duration) AS s FROM songs WHERE id IN (SELECT value FROM json_each(?))')
    .get(JSON.stringify(ids)) as { s: number | null }
  return (row.s ?? 0) / 60
}

function nameOf(db: Database.Database, id: number): string {
  const row = db.prepare('SELECT title FROM songs WHERE id = ?').get(id) as
    { title: string } | undefined
  return row?.title ?? `#${id}`
}

/** `a.b` read out of an answer: `count`, `distinct.albums`, `items.length`. */
function pathOf(value: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (at, key) =>
        at !== null && typeof at === 'object' ? (at as Record<string, unknown>)[key] : undefined,
      value,
    )
}

function inRange(n: number, min?: number, max?: number): boolean {
  return (min === undefined || n >= min) && (max === undefined || n <= max)
}

function rangeWords(want: number | { min?: number; max?: number }): string {
  if (typeof want === 'number') return String(want)
  return `${want.min ?? '…'}–${want.max ?? '…'}`
}

const sameName = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase()
