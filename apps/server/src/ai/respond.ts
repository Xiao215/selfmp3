import { z } from 'zod/v4'
import {
  ASK_CARDS_MAX,
  ASK_CLARIFY_OPTIONS,
  AskOrderSchema,
  AskPlaceSchema,
  AskPlaybackOpSchema,
  AskSortSchema,
  AskStatsRangeSchema,
  CJK,
  NO_JOINS,
  type AskCard,
  type AskPlaybackOp,
  type AskReply,
  type DescribeResult,
  type Song,
  type Understanding,
} from '@selfmp3/shared'
import {
  EVERYTHING,
  instead,
  libraryAnswer,
  matchPlaylist,
  playlistSongs,
  sortSongs,
  type AskPlaylist,
} from './askLibrary.js'
import type { AskDeps } from './askTools.js'
import { MAX_PICKS, groundPlan, songsFitting } from './describe.js'
import { getMusic } from './getMusic.js'
import type { Steps } from './progress.js'
import { scriptOf } from './tagReview.js'
import { numbersIn } from './written.js'
import { ScopeArg, type SetMeta, type WorkingSet } from './workingSet.js'

/**
 * Ask's answer (AGENT-DESIGN 2.4): the agent's terminal `respond` call, made
 * into the reply a device draws (`AskReply`) and checked in code before
 * anything reaches it.
 *
 * The model names what each card shows — a set it made or was given, a
 * proposal it made, a playlist, a playback op — and what the request needs of
 * it (`expect`); everything shown is built here from the sets and proposals,
 * never copied from the model's words. Four checks:
 *
 * 1. Grounding: every set, place, id, proposal and playlist named exists and
 *    was shown or held (`WorkingSet.resolve`, `matchPlaylist`).
 * 2. What was asked: each card's `expect` against the songs it holds — how
 *    many, how long, by whom (credited, other names), in which script where
 *    the names show it, in what order.
 * 3. An empty card says why.
 * 4. Every number in `say` is one the request, the conversation or a tool's
 *    result holds (`written.ts`'s rule).
 *
 * The first time a check fails, the call fails and the model reads what is
 * wrong (`llm.ts` sends a tool's error back). The second time — or when it
 * answers with no tools left — the reply is accepted as well as it can be:
 * songs past the number asked for or by the wrong artist are left out, an
 * order is put right in code, and what is still short becomes the card's note.
 */

/** What the request needs of a card, for code to check against its songs. */
const Expect = z.object({
  count: z.number().int().min(1).max(MAX_PICKS).nullish(),
  minutes: z.number().int().min(1).max(1440).nullish(),
  artists: z.array(z.string().min(1).max(120)).max(12).nullish(),
  script: z.enum(['Chinese', 'Japanese', 'Korean', 'Latin']).nullish(),
  order: z
    .object({ by: z.enum(AskSortSchema.options), dir: z.enum(AskOrderSchema.options) })
    .nullish(),
})
type Expect = z.infer<typeof Expect>

export const CARD_KINDS = [
  'songs',
  'find',
  'library',
  'stats',
  'tags',
  'tidy',
  'copies',
  'playlist',
  'playback',
  'remember',
  'open',
  'getMusic',
  'together',
  'words',
  'clarify',
] as const

/** One card, sparse: each kind reads its own fields and the rest are left out. */
const CardArg = z.object({
  kind: z.enum(CARD_KINDS),
  from: ScopeArg.nullish(),
  proposal: z.string().min(1).max(24).nullish(),
  lead: z.enum(['play', 'save', 'next']).nullish(),
  title: z.string().min(1).max(60).nullish(),
  show: z.enum(['count', 'songs', 'artists', 'albums', 'tags']).nullish(),
  sort: z.enum(AskSortSchema.options).nullish(),
  order: z.enum(AskOrderSchema.options).nullish(),
  range: z.enum(AskStatsRangeSchema.options).nullish(),
  about: z.enum(['songs', 'artists', 'tags', 'totals']).nullish(),
  limit: z.number().int().min(1).max(MAX_PICKS).nullish(),
  op: z
    .enum(['delete', 'rename', 'create', 'add', 'remove', 'sort', ...AskPlaybackOpSchema.options])
    .nullish(),
  playlists: z.array(z.string().min(1).max(120)).max(20).nullish(),
  newName: z.string().min(1).max(80).nullish(),
  at: z.number().int().min(-1000).max(1000).nullish(),
  place: z.enum(AskPlaceSchema.options).nullish(),
  text: z.string().min(1).max(1200).nullish(),
  album: z.boolean().nullish(),
  get: z.string().min(1).max(120).nullish(),
  question: z.string().min(1).max(300).nullish(),
  options: z.array(z.string().min(1).max(120)).max(ASK_CLARIFY_OPTIONS).nullish(),
  note: z.string().min(1).max(300).nullish(),
  expect: Expect.nullish(),
})
type CardArg = z.infer<typeof CardArg>

export const RespondArgs = z.object({
  say: z.string().max(600).nullish(),
  cards: z.array(CardArg).min(1).max(ASK_CARDS_MAX),
})
export type RespondArgs = z.infer<typeof RespondArgs>

/** What `respond` is told about the request it answers. */
export interface Responding {
  readonly deps: AskDeps
  readonly set: WorkingSet
  /** Their newest words. */
  readonly words: string
  readonly playing: Song | undefined
  readonly playlists: readonly AskPlaylist[]
  /** Everything the model was told or shown, where a number in its words must come from. */
  readonly seen: () => string
  readonly steps: Steps
}

/** A check that failed, said so the model can mend it. */
export class RespondProblems extends Error {
  constructor(readonly problems: readonly string[]) {
    super(
      `Not answered yet: ${problems.join(' ')} Mend these and call respond again; when you cannot, call it with what you have and say what is short in the card's note.`,
    )
    this.name = 'RespondProblems'
  }
}

/** One card made: what it shows, and what the checks found. */
interface Made {
  card: AskCard | null
  /** What is wrong, for the model on its first try. */
  problems: string[]
  /** What is short, said under the card once the reply is accepted as it is. */
  notes: string[]
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** Which scripts a song's names are in: what code can tell of its language. */
function scriptsOf(song: Song): Set<string> {
  return new Set([song.title, song.artist, song.album].filter(Boolean).map(name => scriptOf(name)))
}

/** Whether a song's names say plainly it is not in this script. */
function notIn(song: Song, script: NonNullable<Expect['script']>): boolean {
  const scripts = scriptsOf(song)
  switch (script) {
    case 'Chinese':
      return scripts.has('Japanese') || scripts.has('Korean')
    case 'Japanese':
      return scripts.has('Korean')
    case 'Korean':
      return !scripts.has('Korean')
    case 'Latin':
      return CJK.test(`${song.title} ${song.artist}`)
  }
}

/**
 * The songs a card holds, checked against what the request needs of them.
 * Problems for the model; on the last try, the songs put right where code
 * can (too many, the wrong artist or script, out of order) and notes for the
 * rest.
 */
function checked(
  songs: Song[],
  expect: Expect | null | undefined,
  context: Responding,
  label: string,
): { songs: Song[]; problems: string[]; notes: string[] } {
  const problems: string[] = []
  const notes: string[] = []
  if (!expect) return { songs, problems, notes }
  const library = context.deps.songs()
  const tags = context.deps.tags()
  const names = context.deps.artistNames?.() ?? NO_JOINS
  if (expect.artists && expect.artists.length > 0) {
    const { understanding, unknown } = groundPlan(
      { ...EVERYTHING, artists: expect.artists },
      library,
      tags,
      names,
    )
    if (unknown.length > 0) {
      problems.push(
        `${label}: the library has no artist called ${unknown.join(' or ')}; look the name up.`,
      )
    }
    if (understanding.artists.length > 0) {
      const theirs = new Set(
        songsFitting(songs, tags, understanding, context.deps.now?.() ?? Date.now(), names).map(
          song => song.id,
        ),
      )
      const others = songs.filter(song => !theirs.has(song.id))
      if (others.length > 0) {
        problems.push(
          `${label}: ${plural(others.length, 'song is', 'songs are')} by none of ${expect.artists.join(', ')} (${others
            .slice(0, 5)
            .map(song => `“${song.title}”`)
            .join(', ')}).`,
        )
        songs = songs.filter(song => theirs.has(song.id))
      }
    }
  }
  if (expect.script) {
    const script = expect.script
    const others = songs.filter(song => notIn(song, script))
    if (others.length > 0) {
      problems.push(
        `${label}: ${plural(others.length, 'song’s names are', 'songs’ names are')} plainly not ${script} (${others
          .slice(0, 5)
          .map(song => `“${song.title}”`)
          .join(', ')}).`,
      )
      songs = songs.filter(song => !notIn(song, script))
    }
  }
  if (expect.order) {
    const { by, dir } = expect.order
    const sorted = sortSongs(songs, by, dir)
    if (sorted.some((song, index) => song.id !== songs[index]!.id)) {
      problems.push(
        `${label}: the songs are not in ${by} order, ${dir === 'asc' ? 'lowest' : 'highest'} first.`,
      )
      songs = sorted
    }
  }
  if (expect.count) {
    if (songs.length > expect.count) {
      problems.push(`${label}: holds ${songs.length} songs, not the ${expect.count} asked for.`)
      songs = songs.slice(0, expect.count)
    } else if (songs.length < expect.count) {
      problems.push(
        `${label}: holds ${songs.length} ${songs.length === 1 ? 'song' : 'songs'}, not the ${expect.count} asked for.`,
      )
    }
  }
  if (expect.minutes) {
    const target = expect.minutes * 60
    const seconds = songs.reduce((sum, song) => sum + song.duration, 0)
    if (seconds < target * 0.9) {
      problems.push(
        `${label}: plays ${Math.round(seconds / 60)} minutes, not the ${expect.minutes} asked for.`,
      )
    } else if (seconds > target * 1.15 + 300) {
      problems.push(
        `${label}: plays ${Math.round(seconds / 60)} minutes, well past the ${expect.minutes} asked for.`,
      )
      const kept: Song[] = []
      let sum = 0
      for (const song of songs) {
        if (sum >= target) break
        kept.push(song)
        sum += song.duration
      }
      songs = kept
    }
  }
  return { songs, problems, notes }
}

/** A scope's songs, or the error that it names nothing it may. */
function scopeSongs(
  context: Responding,
  from: CardArg['from'],
): { songs: Song[]; meta: SetMeta; why: ReadonlyMap<number, string>; label: string | null } {
  const resolved = context.set.resolve(from)
  // A whole set is what it was made as; a part of it keeps only each song's reason.
  const whole = Boolean(from?.set) && !from?.pick && !from?.drop && !from?.ids && !from?.filters
  const set = from?.set ?? null
  return {
    songs: resolved.songs,
    meta: set ? (whole ? context.set.metaOf(set) : partOf(context.set.metaOf(set))) : {},
    why: set ? context.set.whyOf(set) : new Map(),
    label: set ? context.set.labelOf(set) : null,
  }
}

/** What a part of a set keeps of what the set was made as. */
function partOf(meta: SetMeta): SetMeta {
  return { like: meta.like, lead: meta.lead, terms: meta.terms }
}

/** A list's answer, as Describe gives one: what it understood, how many fit, and the songs. */
function described(
  context: Responding,
  songs: readonly Song[],
  meta: SetMeta,
  why: ReadonlyMap<number, string>,
  name: string,
  expect: Expect | null | undefined,
  notes: readonly string[],
): DescribeResult {
  const library = context.deps.songs()
  const base: Understanding =
    meta.understanding ??
    groundPlan(EVERYTHING, library, context.deps.tags(), context.deps.artistNames?.() ?? NO_JOINS)
      .understanding
  const size = expect?.count ?? (expect?.minutes ? null : base.size)
  return {
    understanding: {
      ...base,
      name: name.trim().slice(0, 60) || 'Songs',
      size,
      minutes: expect?.minutes ?? (size === null ? base.minutes : null),
    },
    fit: meta.fit ?? songs.length,
    loosened: [...(meta.loosened ?? [])],
    unknown: [...(meta.unknown ?? [])],
    notes: [...(meta.notes ?? []), ...notes],
    picks: songs.map(song => ({ songId: song.id, why: why.get(song.id) ?? null })),
  }
}

/** Why an empty card is empty, when anything says: the model's note, or how its set came to none. */
function emptyReason(card: CardArg, meta: SetMeta): string | null {
  return (
    card.note ?? meta.emptiedBy ?? (meta.notes && meta.notes.length > 0 ? meta.notes[0]! : null)
  )
}

async function make(context: Responding, card: CardArg, index: number): Promise<Made> {
  const label = `Card ${index + 1} (${card.kind})`
  const made = (made: AskCard | null, problems: string[] = [], notes: string[] = []): Made => ({
    card: made,
    problems,
    notes,
  })
  const fail = (problem: string, fallback: string): Made =>
    made(instead(fallback), [`${label}: ${problem}`])
  const { deps, set, steps } = context
  switch (card.kind) {
    case 'songs':
    case 'together': {
      if (!card.from) {
        if (card.kind === 'together') return made({ kind: 'together', describe: null })
        return fail(
          'a songs card needs from: the set or places it shows.',
          'I couldn’t tell which songs you mean.',
        )
      }
      const { songs: all, meta, why, label: setLabel } = scopeSongs(context, card.from)
      const lead = card.lead ?? meta.lead ?? 'play'
      // After the song playing, it is not one of them; with nothing playing, "next" plays now.
      const steering = lead === 'next' && context.playing !== undefined
      const pool = steering ? all.filter(song => song.id !== context.playing?.id) : all
      const { songs, problems, notes } = checked(
        pool.slice(0, MAX_PICKS),
        card.expect,
        context,
        label,
      )
      const reason = songs.length === 0 ? emptyReason(card, meta) : null
      if (songs.length === 0 && !reason) {
        problems.push(`${label}: holds no songs. Say why in its note, or look again.`)
      }
      const name =
        card.title ??
        meta.understanding?.name ??
        (card.kind === 'together' ? 'For the room' : setLabel) ??
        'Songs'
      const describe = described(context, songs, meta, why, name, card.expect, [
        ...(card.note && songs.length > 0 ? [card.note] : []),
        ...(songs.length === 0 && reason ? [reason] : []),
      ])
      if (card.kind === 'together') return made({ kind: 'together', describe }, problems, notes)
      return made(
        {
          kind: 'songs',
          lead: lead === 'next' && !steering ? 'play' : lead,
          describe,
          like: meta.like ?? null,
        },
        problems,
        notes,
      )
    }
    case 'find': {
      if (!card.from)
        return fail(
          'a find card needs from: the set of songs that could be it.',
          'I couldn’t find it.',
        )
      const { songs, meta, why } = scopeSongs(context, card.from)
      const problems: string[] = []
      if (songs.length === 0 && !emptyReason(card, meta)) {
        problems.push(`${label}: holds no songs. Say why in its note, or answer in words.`)
      }
      return made(
        {
          kind: 'find',
          terms: [...(meta.terms ?? [])],
          picks: songs
            .slice(0, MAX_PICKS)
            .map(song => ({ songId: song.id, why: why.get(song.id) ?? null })),
        },
        problems,
      )
    }
    case 'library': {
      const { songs, meta } = card.from
        ? scopeSongs(context, card.from)
        : { songs: deps.songs(), meta: {} as SetMeta }
      const question = {
        show: card.show ?? 'count',
        sortBy: card.sort ?? null,
        order: card.order ?? 'desc',
      }
      const plan = { ...EVERYTHING, size: card.limit ?? null }
      const answer = meta.judged
        ? libraryAnswer(deps, plan, question, {
            songIds: songs.map(song => song.id),
            judged: meta.judged.songs,
            of: meta.judged.of,
          })
        : libraryAnswer({ ...deps, songs: () => [...songs] }, plan, question)
      if (answer.kind !== 'library') return made(answer)
      return made({
        ...answer,
        understanding: meta.understanding
          ? { ...meta.understanding, size: card.limit ?? null }
          : answer.understanding,
        unknown: [...(meta.unknown ?? [])],
      })
    }
    case 'stats': {
      const range = card.range ?? '30d'
      const about = card.about ?? 'songs'
      const wanted = Math.min(card.limit ?? 10, 50)
      const stats = deps.stats(range, wanted)
      const items =
        about === 'songs'
          ? stats.topSongs.map(each => ({
              label: `${each.title} · ${each.artist}`,
              plays: each.plays,
              songId: each.songId,
            }))
          : about === 'artists'
            ? stats.topArtists.map(each => ({ label: each.key, plays: each.plays, songId: null }))
            : about === 'tags'
              ? stats.topTags.map(each => ({ label: each.key, plays: each.plays, songId: null }))
              : []
      return made({
        kind: 'stats',
        range,
        about,
        plays: stats.totals.plays,
        minutes: stats.totals.minutes,
        items: items.slice(0, wanted),
      })
    }
    case 'tags':
    case 'tidy':
    case 'copies': {
      const proposal = card.proposal ? set.proposal(card.proposal) : undefined
      if (!proposal) {
        return fail(
          `no proposal is called “${card.proposal ?? ''}”; name the one a propose call kept (its as).`,
          'I couldn’t put that proposal together.',
        )
      }
      if (proposal.kind !== card.kind) {
        return fail(
          `${card.proposal} is a ${proposal.kind} proposal, not ${card.kind}.`,
          'I couldn’t put that proposal together.',
        )
      }
      if (proposal.kind === 'tags') return made({ kind: 'tags', review: proposal.value as never })
      if (proposal.kind === 'tidy') return made({ kind: 'tidy', tidy: proposal.value as never })
      return made({ kind: 'copies', copies: proposal.value as never })
    }
    case 'playlist':
      return playlistCard(context, card, label)
    case 'playback': {
      const op = card.op
      if (!op || !(AskPlaybackOpSchema.options as readonly string[]).includes(op)) {
        return fail(
          `op is one of ${AskPlaybackOpSchema.options.join(', ')}.`,
          'I couldn’t tell what to do with the music.',
        )
      }
      if (op !== 'upNext') {
        return made({ kind: 'playback', op: op as AskPlaybackOp, place: null })
      }
      if (!card.at)
        return fail('upNext needs at: the place in Up next.', 'Say which song in Up next to play.')
      return made({ kind: 'playback', op: 'upNext', place: card.at })
    }
    case 'remember': {
      const note = (card.text ?? '').trim().replace(/\s+/g, ' ')
      if (!note)
        return fail(
          'remember needs text: the preference, as one short rule.',
          'Say what to remember.',
        )
      return made({ kind: 'remember', note })
    }
    case 'open':
      if (!card.place) return fail('open needs place.', 'I couldn’t tell where to go.')
      return made({ kind: 'open', place: card.place, say: card.text ?? '' })
    case 'getMusic': {
      const words = card.text?.trim()
      if (!words)
        return fail('getMusic needs text: what to search 网易云 for.', 'Say what music to get.')
      if (!deps.music) return made(instead('Finding music to import needs your server.'))
      const answer = await getMusic(
        { songs: deps.songs, music: deps.music },
        { words, kind: card.album ? 'album' : 'song' },
        steps,
      )
      return made(answer.items.length > 0 ? answer : instead(`网易云 has nothing for “${words}”.`))
    }
    case 'words': {
      const songs = card.from ? context.set.resolve(card.from).songs : []
      return made({
        kind: 'explore',
        say: card.text ?? '',
        songIds: songs.slice(0, 50).map(song => song.id),
        get: card.get ?? null,
      })
    }
    case 'clarify': {
      if (!card.question)
        return fail('clarify needs a question.', 'Say a little more about what you want.')
      return made({
        kind: 'clarify',
        question: card.question,
        options: (card.options ?? []).slice(0, ASK_CLARIFY_OPTIONS),
      })
    }
  }
}

/** Playlists deleted, renamed, made, or songs put in, taken out or put in order. */
async function playlistCard(context: Responding, card: CardArg, label: string): Promise<Made> {
  const { deps, playlists, steps } = context
  const asked = card.playlists ?? []
  const theirs = playlists.map(each => `“${each.name}”`).join(', ') || 'none'
  const problem = (said: string, fallback: string): Made => ({
    card: instead(fallback),
    problems: [`${label}: ${said}`],
    notes: [],
  })
  switch (card.op) {
    case 'create': {
      const name = (card.newName ?? asked[0] ?? card.title ?? '').trim()
      if (!card.from || !name) {
        return problem(
          'create needs from (its songs) and newName.',
          'Say what to call it and which songs go in.',
        )
      }
      return make(context, { ...card, kind: 'songs', lead: 'save', title: name }, 0)
    }
    case 'delete':
    case 'rename': {
      const matched = asked.map(name => ({ name, found: matchPlaylist(name, playlists) }))
      const names = [...new Set(matched.flatMap(each => each.found ?? []))]
      const unknown = matched.filter(each => each.found === null).map(each => each.name)
      if (names.length === 0) {
        return problem(
          `no playlist is called ${asked.map(name => `“${name}”`).join(' or ') || '(none named)'}; theirs are ${theirs}.`,
          asked.length > 0
            ? `No playlist here is called ${asked.map(name => `“${name}”`).join(' or ')}.`
            : 'Say which playlists you mean.',
        )
      }
      if (card.op === 'rename') {
        const to = (card.newName ?? '').trim().replace(/\s+/g, ' ')
        if (names.length !== 1 || !to || to === names[0]) {
          return problem(
            'rename needs one playlist and a newName.',
            'Say which one playlist to rename, and what to call it.',
          )
        }
        return {
          card: { kind: 'playlists', op: 'rename', names, newName: to, unknown },
          problems: [],
          notes: [],
        }
      }
      return {
        card: { kind: 'playlists', op: 'delete', names, newName: null, unknown },
        problems: [],
        notes: [],
      }
    }
    case 'add':
    case 'remove':
    case 'sort': {
      const name = asked[0] ? matchPlaylist(asked[0], playlists) : null
      const playlist = playlists.find(each => each.name === name)
      if (!playlist) {
        return problem(
          `no playlist is called “${asked[0] ?? ''}”; theirs are ${theirs}.`,
          `No playlist here is called “${asked[0] ?? ''}”.`,
        )
      }
      if (card.op === 'sort' && !card.sort) {
        return problem(
          'sort needs sort: what to put the songs in order by.',
          'Say what to sort it by.',
        )
      }
      const within =
        card.op === 'sort' ? null : card.from ? context.set.resolve(card.from).songs : null
      if (card.op !== 'sort' && !within) {
        return problem(
          `${card.op} needs from: the songs to ${card.op}.`,
          `Say which songs to ${card.op === 'add' ? 'add to' : 'take out of'} ${playlist.name}.`,
        )
      }
      const answer = await playlistSongs(
        deps,
        playlist,
        context.words,
        null,
        { op: card.op, sortBy: card.sort ?? null, order: card.order ?? 'asc' },
        steps,
        within,
      )
      return { card: answer, problems: [], notes: [] }
    }
    default:
      return problem(
        'op is delete, rename, create, add, remove or sort.',
        'I couldn’t tell what to do with your playlists.',
      )
  }
}

/** The sentences of `say` whose numbers are all ones it was given, and the numbers that were not. */
function grounded(say: string, seen: string): { kept: string; strange: number[] } {
  const known = new Set(numbersIn(seen))
  const strange: number[] = []
  const sentences = say.split(/(?<=[.!?。！？])\s*/u).filter(Boolean)
  const kept = sentences.filter(sentence => {
    const wrong = numbersIn(sentence).filter(number => !known.has(number))
    strange.push(...wrong)
    return wrong.length === 0
  })
  return { kept: kept.join(' ').trim(), strange }
}

/** The numbers a reply's own cards hold, which its words may say. */
function cardNumbers(cards: readonly AskCard[]): string {
  return cards
    .map(card => {
      switch (card.kind) {
        case 'songs':
        case 'together':
          return card.describe ? `${card.describe.picks.length} ${card.describe.fit}` : ''
        case 'find':
          return String(card.picks.length)
        case 'library':
          return `${card.count} ${Math.round(card.seconds / 60)} ${Math.round(card.seconds / 3600)} ${card.distinct.artists} ${card.distinct.albums} ${card.distinct.tags}`
        case 'tags':
          return `${card.review.changes.length} ${card.review.looked}`
        case 'tidy':
          return `${card.tidy.changes.length} ${card.tidy.looked}`
        case 'copies':
          return `${card.copies.copies.length} ${card.copies.looked}`
        case 'playlistSongs':
          return String(card.songs.length)
        case 'stats':
          return `${card.plays} ${Math.round(card.minutes)} ${card.items.map(item => item.plays).join(' ')}`
        default:
          return ''
      }
    })
    .join(' ')
}

/**
 * The model's `respond`, made into a reply and checked. `last`: no second
 * try is left, so it is accepted as well as it can be. Otherwise a failed
 * check throws `RespondProblems`, which the model reads.
 */
export async function respond(
  context: Responding,
  args: RespondArgs,
  last: boolean,
): Promise<AskReply> {
  const problems: string[] = []
  const madeCards: Made[] = []
  for (const [index, card] of args.cards.entries()) {
    try {
      madeCards.push(await make(context, card, index))
    } catch (caught) {
      const said = caught instanceof Error ? caught.message : String(caught)
      madeCards.push({
        card: null,
        problems: [`Card ${index + 1} (${card.kind}): ${said}`],
        notes: [],
      })
    }
  }
  for (const each of madeCards) problems.push(...each.problems)
  const clarifying = args.cards.some(card => card.kind === 'clarify')
  if (clarifying && args.cards.length > 1) {
    problems.push('A clarify card stands alone: ask the question back, or answer, not both.')
  }
  let cards = madeCards.flatMap(each => (each.card ? [each.card] : []))
  const say = args.say?.trim() || null
  const seen = `${context.seen()}\n${context.words}\n${cardNumbers(cards)}`
  const { kept, strange } = say ? grounded(say, seen) : { kept: null, strange: [] }
  if (strange.length > 0) {
    problems.push(
      `say has ${strange.join(', ')}, which no result shows: say only numbers the results give, or none.`,
    )
  }
  if (problems.length > 0 && !last) throw new RespondProblems(problems)

  // Accepted as it is: what is short goes under its card, or into the words when it has no notes.
  if (clarifying && cards.length > 1) cards = cards.filter(card => card.kind !== 'clarify')
  const extra: string[] = []
  madeCards.forEach(each => {
    const shortfall = each.problems.map(problem => problem.replace(/^Card \d+ \([a-zA-Z]+\): /, ''))
    if (!each.card || shortfall.length === 0) return
    const card = each.card
    if (card.kind === 'songs' || (card.kind === 'together' && card.describe)) {
      const describe = card.kind === 'songs' ? card.describe : card.describe!
      // The device says a list shorter than asked in words of its own (`describeNotes`).
      const said = shortfall.filter(
        problem =>
          !/^holds \d+ songs?, not the \d+ asked for\.$/.test(problem) &&
          !/^plays \d+ minutes, not the \d+ asked for\.$/.test(problem),
      )
      describe.notes.push(...said.filter(problem => !/^holds no songs/.test(problem)))
    }
  })
  // A list that came to nothing and says nothing of why is no answer: left out when others stand.
  const hollow = (card: AskCard): boolean =>
    card.kind === 'songs' && card.describe.picks.length === 0 && card.describe.notes.length === 0
  if (cards.some(card => !hollow(card))) cards = cards.filter(card => !hollow(card))
  cards =
    cards.length > 0
      ? cards
      : [instead(say ?? 'I couldn’t put an answer together. Try saying it another way.')]
  // A question back stands alone; among other cards its question is said as words.
  if (cards.length > 1) {
    cards = cards.map(card =>
      card.kind === 'clarify'
        ? { kind: 'explore', say: card.question, songIds: [], get: null }
        : card,
    )
  }
  let words = (strange.length > 0 ? kept : say) || null
  // A words card with none of its own says the reply's words, which are then not said twice.
  const bare = cards.findIndex(card => card.kind === 'explore' && !card.say)
  if (bare >= 0) {
    const card = cards[bare] as Extract<AskCard, { kind: 'explore' }>
    cards[bare] = { ...card, say: words ?? '' }
    words = null
  }
  if (extra.length > 0) words = [words, ...extra].filter(Boolean).join(' ')
  return { say: words, cards: cards.slice(0, ASK_CARDS_MAX) }
}
