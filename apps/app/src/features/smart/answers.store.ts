import { useSyncExternalStore } from 'react'
import type { DescribeResult } from '@selfmp3/shared'

/**
 * Ask's song answers, kept while the app is open so an answer can be a page
 * of its own (`/answer?id=…`, docs/features/lists.md, C1) and Back from it
 * finds Search where it was.
 *
 * In memory only: an answer is a suggestion, not a thing you own. Played, it
 * is Up next and Recently played remembers it; saved, it is a playlist. An
 * address to one from before a reload says so and offers Search.
 */

interface KeptAnswer {
  readonly id: string
  /** The words asked. */
  readonly text: string
  readonly result: DescribeResult
}

let answers: ReadonlyMap<string, KeptAnswer> = new Map()
let next = 1
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

/** Keep an answer and say where its page is. The same answer asked twice is kept once. */
export function keepAnswer(text: string, result: DescribeResult): string {
  for (const answer of answers.values()) {
    if (answer.text === text && answer.result === result) return answer.id
  }
  const id = String(next++)
  // Nobody is reading an id that did not exist, so there is no one to tell:
  // and this runs while an answer is drawn, when telling would be a render
  // inside a render.
  answers = new Map([...answers, [id, { id, text, result }]])
  return id
}

/** Different songs: the same question, picked again. */
export function replaceAnswer(id: string, result: DescribeResult): void {
  const answer = answers.get(id)
  if (!answer) return
  answers = new Map([...answers, [id, { ...answer, result }]])
  emit()
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
