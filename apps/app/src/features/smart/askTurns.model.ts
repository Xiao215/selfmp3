import { ASK_ANSWERED_MAX, ASK_BEFORE_MAX, ASK_TEXT_MAX, type AskTurn } from '@selfmp3/shared'

/** One thing asked on the Ask page, and what came of it once it has come. */
export interface Turn {
  /** Names it among the page's turns: its words can repeat. */
  readonly id: number
  readonly asked: string
  /** The song playing when it was asked, by the server's id: what "this" meant then (A8). */
  readonly playing: number | null
  /**
   * The conversation it follows on from (`beforeTurn`), fixed when it is
   * asked: a later recap is not a new question.
   */
  readonly before: readonly AskTurn[]
  /** What its answer showed, in words, for the turns after it; null until it is answered. */
  readonly answered: string | null
  /**
   * What came of a proposal once it was acted on or put aside ("Fixed 31
   * songs", `CLOSED`): the turn keeps the model's words and this line (S1).
   */
  readonly outcome: string | null
  /**
   * The list it changes (B1, 2026-10-26): said with the field's "↳ these
   * songs", the words go to that kept answer (`answers.store`) as Change it's
   * did, rather than being asked of the router. Null for a question.
   */
  readonly change: string | null
  /** The kept answer its songs are, once it has some to show; null for any other answer. */
  readonly list: string | null
  /** What came of it, as Ask's log says it under the question (`logLine`); null until answered. */
  readonly line: string | null
}

/** Whether words are more than Ask takes: they are never sent, and the turn says so. */
export function tooLongToAsk(asked: string): boolean {
  return asked.length > ASK_TEXT_MAX
}

/**
 * The conversation the turn at `index` is asked after (F1): each turn before
 * it with what was shown for it, and what came of a proposal once it did. A
 * long conversation sends only its newest turns, as many as the server
 * hears; a question too long to have been asked is left out, and a recap cut
 * to what the server takes for one.
 */
export function beforeTurn(turns: readonly Turn[], index: number): readonly AskTurn[] {
  return turns
    .slice(0, index)
    .filter(turn => !tooLongToAsk(turn.asked))
    .slice(-ASK_BEFORE_MAX)
    .map(turn => {
      const answered = turn.outcome
        ? `${turn.answered ?? ''}\nThen: ${turn.outcome}`
        : (turn.answered ?? '')
      return {
        asked: turn.asked,
        answered:
          answered.length > ASK_ANSWERED_MAX
            ? `${answered.slice(0, ASK_ANSWERED_MAX - 1)}…`
            : answered,
      }
    })
}

/** A turn asked again (Try again): waiting for its answer, as a new one is. */
export function retried(turns: readonly Turn[], id: number): readonly Turn[] {
  return turns.map(turn => (turn.id === id ? { ...turn, answered: null } : turn))
}

/**
 * What the field holds after Stop: the stopped question back to change, unless
 * something new was already typed there, which is kept.
 */
export function afterStop(typed: string, stopped: string): string {
  return typed.trim() === '' ? stopped : typed
}

/** Where a line sits in the log's lines, and what of them is in view. */
interface Span {
  readonly y: number
  readonly height: number
}

/**
 * Where the log scrolls to bring a line into view, with `room` around it, or
 * null when it is in view already. A line above is brought to the top, one
 * below — a new question, under the field — to the foot.
 */
export function scrollToShow(line: Span, view: Span, room: number): number | null {
  if (line.y < view.y) return Math.max(0, line.y - room)
  const end = line.y + line.height
  if (end > view.y + view.height) return Math.max(0, end + room - view.height)
  return null
}
