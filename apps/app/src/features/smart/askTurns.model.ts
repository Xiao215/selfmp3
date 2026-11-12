import type { AskCard, AskObject, AskObjectKind, AskTurn } from '@selfmp3/shared'

/** One thing asked on the Ask page, and what came of it once it has come. */
export interface Turn {
  /** Names it among the page's turns: its words can repeat. */
  readonly id: number
  readonly asked: string
  /** The song playing when it was asked, by the server's id: what "this" meant then (A8). */
  readonly playing: number | null
  /**
   * The list open when it was asked, by its object's handle: what "these"
   * meant then. Null when none was.
   */
  readonly screen: string | null
  /**
   * The conversation it follows on from (shared `beforeTurn`), fixed when it is
   * asked: a later recap is not a new question.
   */
  readonly before: readonly AskTurn[]
  /** What its reply showed, in words, for the turns after it; null until it is answered. */
  readonly answered: string | null
  /**
   * What came of each proposal in its reply once it was acted on or put aside
   * ("Fixed 31 songs", `CLOSED`), by the card's place: the card keeps the
   * model's words and this line (S1).
   */
  readonly outcomes: Readonly<Record<number, string>>
  /**
   * What its reply showed, as objects the turns after it name by handle
   * (`objectsOf`), a card's each; empty until it is answered, and for a reply of words.
   */
  readonly objects: readonly AskObject[]
  /**
   * The lists its reply shows that open beside the conversation (on a phone,
   * as a page of their own), in the reply's order, once they have songs: each
   * by its kept answer, its object's handle (`t2.1`), and what the words led
   * with. The page's newest is what opens by itself.
   */
  readonly lists: readonly TurnList[]
  /** Its reply's cards, by kind in their places; empty until it is answered. */
  readonly kinds: readonly AskCard['kind'][]
}

/** A list a turn's reply shows, as the page opens it. */
export interface TurnList {
  /** Its kept answer (`answers.store`). */
  readonly id: string
  /** Its object's handle: what the screen is while it is open. */
  readonly handle: string
  readonly lead: 'play' | 'save'
}

/** A turn asked again (Try again): waiting for its answer, as a new one is. */
export function retried(turns: readonly Turn[], id: number): readonly Turn[] {
  return turns.map(turn =>
    turn.id === id ? { ...turn, answered: null, outcomes: {}, objects: [], kinds: [] } : turn,
  )
}

/**
 * Cards that are a proposal: once acted on or put aside (Apply, Close, Not
 * now), the card folds to the line it was answered with. The rest stay as
 * they are, since playing a song from an answer is not the end of it.
 */
export const PROPOSALS: ReadonlySet<AskCard['kind']> = new Set([
  'tags',
  'tidy',
  'copies',
  'remember',
  'playlists',
  'playlistSongs',
  'deleteSongs',
])

/**
 * The proposals a later one of the same kind took the place of, by turn and
 * the card's place: a second plan for the names after "and these too" is the
 * one to apply, and the first stays only to read, its buttons greyed. One put
 * aside or acted on already is left as it came to; lists are not proposals,
 * each a version of its own to play.
 */
export function outdatedCards(turns: readonly Turn[]): ReadonlyMap<number, ReadonlySet<number>> {
  const outdated = new Map<number, Set<number>>()
  const later = new Set<AskCard['kind']>()
  for (const turn of [...turns].reverse()) {
    turn.kinds.forEach((kind, place) => {
      if (!PROPOSALS.has(kind) || !later.has(kind) || turn.outcomes[place] !== undefined) return
      const cards = outdated.get(turn.id) ?? new Set<number>()
      outdated.set(turn.id, cards.add(place))
    })
    for (const kind of turn.kinds) later.add(kind)
  }
  return outdated
}

/**
 * What the field holds after Stop: the stopped question back to change, unless
 * something new was already typed there, which is kept.
 */
export function afterStop(typed: string, stopped: string): string {
  return typed.trim() === '' ? stopped : typed
}

/**
 * An earlier answer as a later reply names it (`AskReply.from`): what it is
 * called, the turn that showed it, its songs by the server's id, and the list
 * it opens as, when it is one.
 */
export interface Named {
  readonly label: string
  readonly turnId: number
  readonly kind: AskObjectKind
  readonly songIds: readonly number[]
  readonly list: TurnList | null
}

/** Every answer the conversation has shown so far, by handle. */
export function namedObjects(turns: readonly Turn[]): ReadonlyMap<string, Named> {
  const named = new Map<string, Named>()
  for (const turn of turns) {
    for (const object of turn.objects) {
      named.set(object.handle, {
        label: object.label,
        turnId: turn.id,
        kind: object.kind,
        songIds: object.songIds,
        list: turn.lists.find(list => list.handle === object.handle) ?? null,
      })
    }
  }
  return named
}

/** The line over a reply made from earlier answers: "From “Calm study night”". */
export function fromLine(labels: readonly string[]): string | null {
  const [first, second] = labels
  if (first === undefined) return null
  if (second === undefined) return `From “${first}”`
  if (labels.length === 2) return `From “${first}” and “${second}”`
  return `From “${first}” and ${labels.length - 1} more`
}

/**
 * How a list differs from the earlier one it was made from: the songs that
 * went and the songs that came. Null when nothing did (the same songs, saved
 * or played), and when they share too little for that to mean anything
 * (under half of the earlier one): a new list that only took a song or two
 * from it, not a change to it.
 */
export function listChange(
  earlier: readonly number[],
  now: readonly number[],
): { removed: number; added: number } | null {
  if (earlier.length === 0) return null
  const was = new Set(earlier)
  const is = new Set(now)
  const kept = [...was].filter(id => is.has(id)).length
  if (kept * 2 < was.size) return null
  const change = { removed: was.size - kept, added: is.size - kept }
  return change.removed === 0 && change.added === 0 ? null : change
}

/** Where a turn sits in the conversation, and what of it is in view. */
interface Span {
  readonly y: number
  readonly height: number
}

/**
 * Where the conversation scrolls to bring a turn into view, with `room`
 * around it, or null when it is in view already. One above is brought to the
 * top, one below to the foot.
 */
export function scrollToShow(line: Span, view: Span, room: number): number | null {
  if (line.y < view.y) return Math.max(0, line.y - room)
  const end = line.y + line.height
  if (end > view.y + view.height) return Math.max(0, end + room - view.height)
  return null
}
