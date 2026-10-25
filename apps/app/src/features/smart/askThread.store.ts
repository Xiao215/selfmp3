import type { Turn } from './askTurns.model'

/**
 * The Ask page's conversations, by the words it was opened with, while the
 * app is open: a page drawn again — Back in a browser from an answer's page,
 * which draws Ask anew — finds its turns rather than only the first. Its ‹
 * lets the conversation go, as it always has (docs/features/ai.md, "The Ask
 * page"): a question asked again from Search starts afresh.
 */
const threads = new Map<string, readonly Turn[]>()

/** The most conversations kept; past that the oldest goes. */
const KEPT = 10

export function keptThread(opened: string): readonly Turn[] | undefined {
  return threads.get(opened)
}

export function keepThread(opened: string, turns: readonly Turn[]): void {
  threads.delete(opened)
  if (turns.length === 0) return
  threads.set(opened, turns)
  for (const oldest of threads.keys()) {
    if (threads.size <= KEPT) break
    threads.delete(oldest)
  }
}

export function forgetThread(opened: string): void {
  threads.delete(opened)
}
