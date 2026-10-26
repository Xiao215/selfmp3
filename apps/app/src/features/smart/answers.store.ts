import { useSyncExternalStore } from 'react'
import type { DescribeResult } from '@selfmp3/shared'

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
 */
interface KeptAnswer {
  readonly id: string
  /** The words first asked. */
  readonly text: string
  readonly result: DescribeResult
  /** The songs in the order you put them in, by this device's ids; null for the answer's own. */
  readonly order: readonly number[] | null
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
 * Keep an answer and say where its page is. The same answer asked twice is
 * kept once: one changed since on its page is still the one it came as.
 */
export function keepAnswer(text: string, result: DescribeResult): string {
  for (const [id, first] of firsts) {
    if (first.text === text && first.result === result) return id
  }
  const id = String(next++)
  // Nobody is reading an id that did not exist, so there is no one to tell:
  // and this runs while an answer is drawn, when telling would be a render
  // inside a render.
  answers = new Map([...answers, [id, { id, text, result, order: null }]])
  firsts.set(id, { text, result })
  return id
}

/** The answer changed on its page (Change it, Different songs): the new songs, in their own order. */
export function changeAnswer(id: string, result: DescribeResult): void {
  const answer = answers.get(id)
  if (answer) put({ ...answer, result, order: null })
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

export function useKeptAnswer(id: string | undefined): KeptAnswer | null {
  return useSyncExternalStore(
    subscribe,
    () => (id ? (answers.get(id) ?? null) : null),
    () => null,
  )
}
