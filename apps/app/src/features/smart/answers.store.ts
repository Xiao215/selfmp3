import { useSyncExternalStore } from 'react'
import type { DescribeResult, Understanding } from '@selfmp3/shared'

/**
 * Ask's song answers, kept while the app is open so an answer can be a page
 * of its own (`/answer?id=…`, docs/features/lists.md, C1), Back from it finds
 * Ask where it was, and a change in words knows the songs it changes.
 *
 * In memory only: an answer is a suggestion, not a thing you own. Played, it
 * is Up next and Recently played remembers it; saved, it is a playlist. An
 * address to one from before a reload says so and offers Search.
 *
 * A change said in Ask's field is an answer of its own, kept beside the one it
 * changed (B1, 2026-10-26): the thread is the trail of versions. One made on
 * the answer's page (its Change it, Different songs) changes that answer.
 *
 * What is kept is a card, not a reply: each songs card of a reply is an answer
 * of its own, with its own page, order and changes, however many lists the
 * reply holds.
 */
interface KeptAnswer {
  readonly id: string
  /** The words first asked. */
  readonly text: string
  readonly result: DescribeResult
  /** The songs in the order you put them in, by this device's ids; null for the answer's own. */
  readonly order: readonly number[] | null
  /**
   * What it understood with chips taken away, while the songs for it are on
   * their way (or could not come); null when unchanged. Kept with the answer, so a change in words starts
   * from what is shown and the next list opened does not inherit it.
   */
  readonly edited: Understanding | null
}

let answers: ReadonlyMap<string, KeptAnswer> = new Map()
/** What each answer came as, to find it again when it is drawn again. */
const firsts = new Map<string, { text: string; result: DescribeResult }>()
let next = 1
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function put(answer: KeptAnswer): void {
  answers = new Map([...answers, [answer.id, answer]])
  emit()
}

/**
 * Keep an answer — a songs card's songs — and say where its page is. The same
 * card drawn twice is kept once: one changed since on its page is still the
 * one it came as. Two cards of one reply are two answers, though asked in the
 * same words.
 */
export function keepAnswer(text: string, result: DescribeResult): string {
  for (const [id, first] of firsts) {
    if (first.text === text && first.result === result) return id
  }
  const id = String(next++)
  // Nobody is reading an id that did not exist, so there is no one to tell:
  // and this runs while an answer is drawn, when telling would be a render
  // inside a render.
  answers = new Map([...answers, [id, { id, text, result, order: null, edited: null }]])
  firsts.set(id, { text, result })
  return id
}

/**
 * The answer changed on its page (Change it, Different songs, a chip taken
 * away): the new songs, in their own order. Given what they were picked
 * `from`, songs for an answer changed again since stay out: two chips taken
 * away quickly keep the songs for both, whichever comes back last.
 */
export function changeAnswer(id: string, result: DescribeResult, from?: Understanding): void {
  const answer = answers.get(id)
  if (!answer) return
  if (from && understandingOf(answer) !== from) return
  put({ ...answer, result, order: null, edited: null })
}

/** A chip taken away on the answer's page: what it picks again from, and a change in words starts from. */
export function editAnswer(id: string, edited: Understanding): void {
  const answer = answers.get(id)
  if (answer) put({ ...answer, edited })
}

/** What a change to an answer starts from: what it understood, less any chip taken away. */
export function understandingOf(answer: KeptAnswer): Understanding {
  return answer.edited ?? answer.result.understanding
}

/** Songs held and moved on the answer's page: the order it plays and saves in. */
export function reorderAnswer(id: string, order: readonly number[]): void {
  const answer = answers.get(id)
  if (answer) put({ ...answer, order: [...order] })
}

/** An answer as it is now, outside React. */
export function keptAnswer(id: string): KeptAnswer | null {
  return answers.get(id) ?? null
}

/** The songs of an answer as it is now, outside React: what Recently played keeps of it. */
export function answerShowing(id: string): DescribeResult | null {
  return answers.get(id)?.result ?? null
}

/**
 * The songs an answer shows, by the server's ids, in the order shown: what a
 * change keeps where it still fits (`/api/ai/refine`). The order you set is
 * in this device's ids; the picks are the server's.
 */
export function shownOnServer(
  answer: KeptAnswer,
  onServer: (id: number) => number | undefined,
): number[] {
  return (answer.order ?? answer.result.picks.map(pick => pick.songId)).flatMap(id => {
    const serverId = answer.order ? onServer(id) : id
    return serverId === undefined ? [] : [serverId]
  })
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Every answer kept, as they are now: for a reply whose lists are as many as its cards. */
export function useKeptAnswers(): ReadonlyMap<string, KeptAnswer> {
  return useSyncExternalStore(
    subscribe,
    () => answers,
    () => answers,
  )
}

export function useKeptAnswer(id: string | undefined): KeptAnswer | null {
  return useSyncExternalStore(
    subscribe,
    () => (id ? (answers.get(id) ?? null) : null),
    () => null,
  )
}
