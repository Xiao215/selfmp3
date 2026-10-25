import type { ReactNode } from 'react'
import { plural, type Song } from '@selfmp3/shared'
import { failureWords } from '@selfmp3/client'

/**
 * Short messages about what just happened.
 *
 * The messages live in a module, not in a component: almost everything worth
 * announcing is the result of an action that removes whatever started it.
 * "Removed 3 songs" is raised by a selection bar the removal has just
 * emptied, and a toast owned by that bar would vanish in the same frame it
 * appeared.
 */

export type ToastTone = 'info' | 'good' | 'warn' | 'error'

/**
 * What a message says, in up to three lines.
 *
 * `say` is the line in bold: the whole of a short message ("Link copied"), or
 * the thing a message is about — a song's title, a playlist's name — with
 * `over` saying what happened to it ("Removed from Up next"). Put into one
 * sentence, a long title wrapped the message onto two lines with the verb
 * lost at the front of it. `under` says why, or what comes next.
 */
export interface ToastWords {
  readonly say: string
  readonly over?: string
  readonly under?: string
}

/**
 * A word in the message you can press.
 *
 * Kept to one or two, and each one word: a toast is read in passing, and by
 * the third choice it has become a dialogue that happens to be the wrong shape.
 * Pressing one dismisses the message — the action is the answer to it.
 */
interface ToastAction {
  readonly label: string
  readonly onPress: () => void
}

export interface Toast extends ToastWords {
  readonly id: number
  readonly tone: ToastTone
  /** Zero keeps it until dismissed: for anything that went wrong. */
  readonly autoDismissMs: number
  /** When its time began: the bar along its foot empties from here, and a fold starts it again. */
  readonly since: number
  readonly actions: readonly ToastAction[]
  /** The songs it is about, drawn as their covers where it starts. */
  readonly songs: readonly Song[]
  /** Something else drawn there instead: the face of a friend who came into the room. */
  readonly art?: ReactNode
  readonly group?: string
  /** How many messages are folded into it: the count its `say` names once there are two. */
  readonly count: number
}

interface ToastOptions {
  readonly autoDismissMs?: number
  readonly actions?: readonly ToastAction[]
  readonly songs?: readonly Song[]
  readonly art?: ReactNode
  /**
   * Messages of one kind raised while the last is still up fold into it
   * rather than piling up: three swipes in Up next are one "Removed from Up
   * next · 3 songs", whose Undo puts all three back. The songs add up, and
   * the time starts again.
   */
  readonly group?: string
}

let toasts: readonly Toast[] = []
let nextId = 1
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

/** The message up of this kind, to fold a new one into. */
function upIn(group: string | undefined): Toast | undefined {
  return group === undefined ? undefined : toasts.find(toast => toast.group === group)
}

/** Raises a message, and hands back its id for one that may stop being true before it times out. */
export function showToast(
  message: string | ToastWords,
  tone: ToastTone = 'info',
  options: ToastOptions = {},
): number {
  const words = typeof message === 'string' ? { say: message } : message
  const actions = options.actions ?? []
  const earlier = upIn(options.group)
  const songs = [...(earlier?.songs ?? []), ...(options.songs ?? [])]
  const count = (earlier?.count ?? 0) + 1
  const toast: Toast = {
    ...words,
    // Folded together it is about all of them, and the count names them:
    // every kind that folds is about songs.
    say: earlier ? plural(count, 'song', 'songs') : words.say,
    count,
    id: earlier?.id ?? nextId++,
    tone,
    // A message you can act on is given longer: five seconds is enough to
    // read "Saved", and not enough to decide you would rather it was called
    // something else.
    autoDismissMs:
      options.autoDismissMs ?? (tone === 'error' ? 0 : actions.length > 0 ? 9000 : 5000),
    since: Date.now(),
    actions,
    songs,
    art: options.art,
    group: options.group,
  }
  toasts = earlier ? toasts.map(up => (up === earlier ? toast : up)) : [...toasts, toast]
  emit()
  return toast.id
}

/** A failed edit's message: what did not happen, and why under it (`failureWords`). */
export function showFailure(failure: string, caught: unknown): number {
  return showToast(failureWords(failure, caught), 'error')
}

/** How long a removal can be taken back: five seconds, wherever it was made (`C12`). */
const UNDO_MS = 5000

/** The Undo of a message that holds several folded together. */
function undoLabel(count: number): string {
  return count > 1 ? 'Undo all' : 'Undo'
}

/** Each undo message's undos, oldest first, so a fold can put back all of them. */
const undoing = new Map<number, readonly (() => unknown)[]>()

/**
 * Something done, said with an Undo for `UNDO_MS`: Up next's rows and its
 * Clear the rest, a playlist saved, an Ask's changes. Removals that are
 * easier not sent than sent and taken back wait for their Undo to go instead
 * (`showPendingToast`), and ones that would have to be put back on every
 * device ask first.
 *
 * `undo` may be work that takes a while: once it has finished, `after` says
 * so ("Put your tags back"); if it fails, `failed` says that ("Couldn't undo
 * that, …"), or nothing does when the edit that failed has said so itself.
 * `also` goes before Undo: Open, beside a playlist just saved.
 */
export function showUndoToast(
  message: string | ToastWords,
  undo: () => unknown,
  options: {
    tone?: ToastTone
    after?: string
    failed?: string
    also?: readonly ToastAction[]
    songs?: readonly Song[]
    group?: string
  } = {},
): void {
  const { tone = 'info', after, failed, also = [], songs, group } = options
  const earlier = upIn(group)
  const undos = [...((earlier && undoing.get(earlier.id)) ?? []), undo]
  const run = (): void => {
    Promise.resolve()
      .then(async () => {
        // Newest first: each puts its song back into the list the later one left.
        for (const each of [...undos].reverse()) await each()
      })
      .then(
        () => {
          if (after) showToast(after, 'info')
        },
        (caught: unknown) => {
          if (failed) showFailure(failed, caught)
        },
      )
  }
  const id = showToast(message, tone, {
    autoDismissMs: UNDO_MS,
    songs,
    group,
    actions: [...also, { label: undoLabel(undos.length), onPress: run }],
  })
  undoing.set(id, undos)
}

/** A send waiting on its Undo. */
interface Waiting {
  readonly go: () => void
  timer: ReturnType<typeof setTimeout>
  readonly undone?: () => void
}

/** What `showPendingToast` has said is done and not sent yet: each sends itself when called. */
const pending = new Set<() => void>()
/** Each pending message's sends, so a fold can wait for all of them and undo all of them. */
const waiting = new Map<number, readonly Waiting[]>()

/**
 * Something said done that is only sent once its Undo has gone, as an email
 * client's undo-send: songs out of a playlist, downloads off this device,
 * playlists an Ask deleted, an extra copy folded into the one kept. The caller
 * shows it done at once (hides the rows); Undo within `UNDO_MS` cancels it
 * before anything was written, and `undone` puts back whatever the caller set
 * aside meanwhile. Nothing goes to the server and back for a change of mind.
 *
 * Otherwise `send` runs when the time is up, wherever the app is by then, or
 * sooner when the app is leaving (`sendPending`): a phone sent to the
 * background or a closing tab sends it rather than losing it. If it fails,
 * `failed` says so.
 */
export function showPendingToast(
  message: string | ToastWords,
  send: () => unknown,
  options: {
    tone?: ToastTone
    failed?: string
    undone?: () => void
    songs?: readonly Song[]
    art?: ReactNode
    group?: string
  } = {},
): void {
  const { tone = 'info', failed, undone, songs, art, group } = options
  const earlier = upIn(group)
  const together = (earlier && waiting.get(earlier.id)) ?? []
  // Folded in, the earlier ones wait as long as the message now says, and
  // are still sent first.
  for (const each of together) {
    clearTimeout(each.timer)
    each.timer = setTimeout(() => each.go(), UNDO_MS)
  }
  let id = 0
  /** Takes it out of the waiting; false when it was sent or undone already. */
  const settle = (entry: Waiting): boolean => {
    if (!pending.delete(entry.go)) return false
    clearTimeout(entry.timer)
    return true
  }
  const entry: Waiting = {
    go: () => {
      if (!settle(entry)) return
      // Its Undo would be a promise broken: the message goes as it is sent.
      dismissToast(id)
      Promise.resolve()
        .then(send)
        .catch((caught: unknown) => {
          if (failed) showFailure(failed, caught)
        })
    },
    timer: setTimeout(() => entry.go(), UNDO_MS),
    undone,
  }
  pending.add(entry.go)
  const all = [...together, entry]
  id = showToast(message, tone, {
    autoDismissMs: UNDO_MS,
    songs,
    art,
    group,
    actions: [
      {
        label: undoLabel(all.length),
        onPress: () => {
          for (const each of [...all].reverse()) if (settle(each)) each.undone?.()
        },
      },
    ],
  })
  waiting.set(id, all)
}

/** Sends everything still waiting on its Undo, now: the app is going to the background or closing. */
export function sendPending(): void {
  for (const go of [...pending]) go()
}

export function dismissToast(id: number): void {
  undoing.delete(id)
  waiting.delete(id)
  toasts = toasts.filter(toast => toast.id !== id)
  emit()
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function currentToasts(): readonly Toast[] {
  return toasts
}
