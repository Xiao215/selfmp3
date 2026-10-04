import { useSyncExternalStore } from 'react'
import type { DescribeResult } from '@selfmp3/shared'

/**
 * Ask's song answers, kept while the app is open so an answer can be a page
 * of its own (`/answer?id=…`, docs/features/lists.md, C1), Back from it finds
 * Search where it was, and a changed answer can go back to how it was.
 *
 * In memory only: an answer is a suggestion, not a thing you own. Played, it
 * is Up next and Recently played remembers it; saved, it is a playlist. An
 * address to one from before a reload says so and offers Search.
 */

/** One version of an answer: the first, or one after a change. */
interface AnswerStep {
  /** What was said to make it — "10 首", "Different songs" — or null for the first. */
  readonly said: string | null
  readonly result: DescribeResult
  /** The songs in the order you put them in, by this device's ids; null for the answer's own. */
  readonly order: readonly number[] | null
}

interface KeptAnswer {
  readonly id: string
  /** The words first asked. */
  readonly text: string
  /** Every version, oldest first (docs/features/ai.md, "Change it"). */
  readonly steps: readonly AnswerStep[]
  /** Which version is showing. */
  readonly at: number
  /** The showing version's songs and order, for the screens that only want those. */
  readonly result: DescribeResult
  readonly order: readonly number[] | null
}

let answers: ReadonlyMap<string, KeptAnswer> = new Map()
let next = 1
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function showing(answer: Omit<KeptAnswer, 'result' | 'order'>): KeptAnswer {
  const step = answer.steps[answer.at]!
  return { ...answer, result: step.result, order: step.order }
}

function put(answer: KeptAnswer): void {
  answers = new Map([...answers, [answer.id, answer]])
  emit()
}

/** Keep an answer and say where its page is. The same answer asked twice is kept once. */
export function keepAnswer(text: string, result: DescribeResult): string {
  for (const answer of answers.values()) {
    if (answer.text === text && answer.steps[0]?.result === result) return answer.id
  }
  const id = String(next++)
  // Nobody is reading an id that did not exist, so there is no one to tell:
  // and this runs while an answer is drawn, when telling would be a render
  // inside a render.
  answers = new Map([
    ...answers,
    [id, showing({ id, text, steps: [{ said: null, result, order: null }], at: 0 })],
  ])
  return id
}

/**
 * A new version, from a change or Different songs. It follows the one showing;
 * versions after that one, left when you went back, are let go, as an undo
 * history lets go of what was undone once something new is done.
 */
export function changeAnswer(id: string, said: string, result: DescribeResult): void {
  const answer = answers.get(id)
  if (!answer) return
  const steps = [...answer.steps.slice(0, answer.at + 1), { said, result, order: null }]
  put(showing({ ...answer, steps, at: steps.length - 1 }))
}

/** Back, or forward again, to a version from the trail. */
export function showAnswerStep(id: string, at: number): void {
  const answer = answers.get(id)
  if (!answer || at < 0 || at >= answer.steps.length || at === answer.at) return
  put(showing({ ...answer, at }))
}

/** Songs held and moved on the answer's page: the order the version showing plays and saves in. */
export function reorderAnswer(id: string, order: readonly number[]): void {
  const answer = answers.get(id)
  if (!answer) return
  const steps = answer.steps.map((step, index) =>
    index === answer.at ? { ...step, order: [...order] } : step,
  )
  put(showing({ ...answer, steps }))
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
