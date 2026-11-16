import { useSyncExternalStore } from 'react'
import { z } from 'zod'
import { AskObjectSchema, AskReplySchema, AskTurnSchema } from '@selfmp3/shared'
import { prefs } from '../../ports/prefs'
import { readTabSession, writeTabSession } from '../../ports/tabSession'
import type { Turn } from './askTurns.model'

/**
 * The Ask page's conversations, each by the thread in its address
 * (`/ask?q=…&thread=…`): one per visit, so the page drawn again — Back in a
 * browser from an answer's page — finds its turns rather than only the
 * first, while the same words asked again from Search are a new visit and
 * start afresh.
 *
 * Kept on this device too, the newest few (E1, Xiao 2026-11-16): Search's
 * Recent and the palette's list them, and pressing one opens it where it was
 * left. Only what was answered is kept there, each turn with its reply, so a
 * conversation reopened is drawn from what came rather than asked again; and
 * it comes back marked as such (`broughtBack`), so a "play …" or "skip this
 * song" in it is not done a second time. A room's conversation is kept for
 * the visit only: it was about a room that is gone.
 *
 * A reload loses the turns of one that isn't kept, but not that the thread
 * was asked: the tab keeps that (`tabSession`), and the page opens with
 * nothing asked rather than ask its first question again.
 */

/** A conversation as Recent lists it. */
export interface AskedThread {
  readonly thread: string
  /** Its first question: what it is called in a list. */
  readonly asked: string
  /** When it was last asked something, as an ISO stamp. */
  readonly at: string
  readonly questions: number
}

interface Kept {
  readonly at: string
  readonly turns: readonly Turn[]
  /** Kept on the device, and listed in Recent: not a room's. */
  readonly listed: boolean
}

/** Where the device keeps them, the newest first. */
const KEY = 'ask.threads'

/** The most conversations kept on the device; past that the oldest goes. */
const KEPT = 8

/** The most conversations kept for this run, kept or not; past that the oldest goes. */
const IN_MEMORY = 10

/** Where the tab keeps the threads it asked, the newest last. */
const ASKED_KEY = 'selfmp3.ask.asked'

/** The most threads the tab remembers asking. */
const ASKED_KEPT = 100

const StoredTurnSchema = z.object({
  id: z.number(),
  asked: z.string(),
  playing: z.number().nullable(),
  screen: z.string().nullable(),
  before: z.array(AskTurnSchema),
  answered: z.string(),
  outcomes: z.record(z.string(), z.string()),
  objects: z.array(AskObjectSchema),
  kinds: z.array(z.string()),
  reply: AskReplySchema,
  carried: z.record(z.string(), z.string()),
})

const StoredSchema = z.array(
  z.object({ thread: z.string(), at: z.string(), turns: z.array(StoredTurnSchema).min(1) }),
)

type Stored = z.infer<typeof StoredSchema>

/** Newest first. */
let threads = new Map<string, Kept>(read())
let listedNow: readonly AskedThread[] = listed()
/** What the device was last given, so an unchanged conversation is not written again. */
let written = prefs.get(KEY)
const listeners = new Set<() => void>()

function read(): [string, Kept][] {
  try {
    const parsed = StoredSchema.safeParse(JSON.parse(prefs.get(KEY) ?? '[]'))
    if (!parsed.success) return []
    return parsed.data.map(each => [
      each.thread,
      {
        at: each.at,
        listed: true,
        turns: each.turns.map(turn => ({
          ...turn,
          outcomes: byPlace(turn.outcomes),
          carried: byPlace(turn.carried),
          kinds: turn.kinds as Turn['kinds'],
          // A list's kept answer lives only as long as the run; its card keeps it again.
          lists: [],
          broughtBack: true,
        })),
      },
    ])
  } catch {
    return []
  }
}

function byPlace(record: Readonly<Record<string, string>>): Readonly<Record<number, string>> {
  return Object.fromEntries(Object.entries(record).map(([place, said]) => [Number(place), said]))
}

/** What the device keeps of them: the listed ones' answered turns. */
function stored(): Stored {
  const out: Stored[number][] = []
  for (const [thread, kept] of threads) {
    if (!kept.listed) continue
    const turns = kept.turns.flatMap(turn =>
      turn.answered !== null && turn.reply !== null
        ? [
            {
              id: turn.id,
              asked: turn.asked,
              playing: turn.playing,
              screen: turn.screen,
              before: [...turn.before],
              answered: turn.answered,
              outcomes: turn.outcomes,
              objects: [...turn.objects],
              kinds: [...turn.kinds],
              reply: turn.reply,
              carried: turn.carried,
            },
          ]
        : [],
    )
    if (turns.length > 0) out.push({ thread, at: kept.at, turns })
    if (out.length === KEPT) break
  }
  return out
}

function listed(): readonly AskedThread[] {
  return stored().map(each => ({
    thread: each.thread,
    asked: each.turns[0]!.asked,
    at: each.at,
    questions: each.turns.length,
  }))
}

/** A new visit's thread. */
export function newThread(): string {
  return Math.random().toString(36).slice(2, 10)
}

/**
 * The turns a page on `thread` opens with: the conversation it had, none when
 * it was asked and its turns are gone (a reload of one not kept), or
 * undefined for a thread not asked yet, whose opening words the page asks.
 */
export function keptThread(thread: string): readonly Turn[] | undefined {
  return threads.get(thread)?.turns ?? (tabAsked().includes(thread) ? [] : undefined)
}

/**
 * The page's turns as they are now. A new question moves the conversation to
 * the front; an answer coming in, or a card acted on, leaves it where it is.
 * `listed` is false for a room's.
 */
export function keepThread(thread: string, turns: readonly Turn[], listed = true): void {
  const was = threads.get(thread)
  if (turns.length === 0) {
    if (!was) return
    threads.delete(thread)
  } else {
    const asked = !was || turns.length > was.turns.length
    const kept: Kept = { at: asked ? new Date().toISOString() : was.at, turns, listed }
    const others = [...threads].filter(([other]) => other !== thread)
    threads = new Map(
      asked
        ? [[thread, kept], ...others]
        : [...threads].map(each => (each[0] === thread ? [thread, kept] : each)),
    )
    while (threads.size > IN_MEMORY) {
      const oldest = [...threads.keys()].at(-1)
      if (oldest === undefined) break
      threads.delete(oldest)
    }
  }
  const asked = tabAsked()
  if (turns.length > 0 && !asked.includes(thread)) {
    writeTabSession(ASKED_KEY, JSON.stringify([...asked, thread].slice(-ASKED_KEPT)))
  }
  save()
}

function save(): void {
  const keep = stored()
  const text = JSON.stringify(keep)
  if (text === written) return
  written = text
  prefs.set(KEY, text)
  listedNow = listed()
  for (const listener of listeners) listener()
}

function tabAsked(): readonly string[] {
  try {
    const asked: unknown = JSON.parse(readTabSession(ASKED_KEY) ?? '[]')
    return Array.isArray(asked) ? asked.filter(each => typeof each === 'string') : []
  } catch {
    return []
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The conversations kept on this device, newest first: Search's Recent and the palette's. */
export function askedThreads(): readonly AskedThread[] {
  return listedNow
}

export function useAskedThreads(): readonly AskedThread[] {
  return useSyncExternalStore(subscribe, askedThreads, askedThreads)
}
