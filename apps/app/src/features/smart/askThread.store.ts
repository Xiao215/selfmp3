import { readTabSession, writeTabSession } from '../../ports/tabSession'
import type { Turn } from './askTurns.model'

/**
 * The Ask page's conversations, while the app is open, each by the thread in
 * its address (`/ask?q=…&thread=…`): one per visit, so the page drawn again —
 * Back in a browser from an answer's page — finds its turns rather than only
 * the first, while the same words asked again from Search are a new visit and
 * start afresh. Its ‹ lets the conversation go, as it always has
 * (docs/features/ai.md, "The Ask page").
 *
 * A reload loses the turns but not that the thread was asked: the tab keeps
 * that (`tabSession`), and the page opens with nothing asked rather than ask
 * its first question again — "play …" or "skip this song" done a second time
 * nobody asked for.
 */
const threads = new Map<string, readonly Turn[]>()

/** The most conversations kept; past that the oldest goes. */
const KEPT = 10

/** Where the tab keeps the threads it asked, the newest last. */
const ASKED_KEY = 'selfmp3.ask.asked'

/** The most threads the tab remembers asking. */
const ASKED_KEPT = 100

/** A new visit's thread. */
export function newThread(): string {
  return Math.random().toString(36).slice(2, 10)
}

/**
 * The turns a page on `thread` opens with: the conversation it had, none when
 * it was asked and its turns are gone (a reload, or let go), or undefined for
 * a thread not asked yet, whose opening words the page asks.
 */
export function keptThread(thread: string): readonly Turn[] | undefined {
  return threads.get(thread) ?? (askedThreads().includes(thread) ? [] : undefined)
}

export function keepThread(thread: string, turns: readonly Turn[]): void {
  threads.delete(thread)
  if (turns.length === 0) return
  threads.set(thread, turns)
  for (const oldest of threads.keys()) {
    if (threads.size <= KEPT) break
    threads.delete(oldest)
  }
  const asked = askedThreads()
  if (!asked.includes(thread)) {
    writeTabSession(ASKED_KEY, JSON.stringify([...asked, thread].slice(-ASKED_KEPT)))
  }
}

export function forgetThread(thread: string): void {
  threads.delete(thread)
}

function askedThreads(): readonly string[] {
  try {
    const asked: unknown = JSON.parse(readTabSession(ASKED_KEY) ?? '[]')
    return Array.isArray(asked) ? asked.filter(each => typeof each === 'string') : []
  } catch {
    return []
  }
}
