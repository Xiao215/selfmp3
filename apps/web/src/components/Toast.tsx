import { useEffect, useSyncExternalStore } from 'react'
import { X } from './Icons.js'

/**
 * Transient messages, in the app shell's toast row.
 *
 * Toasts here are not an overlay: `.toast-layer` is a real row between the
 * content and the player bar, so a message can never cover a song row or the
 * transport.
 *
 * The queue lives in a module-level store rather than in a component, and for
 * a specific reason: almost everything worth announcing is the *result* of an
 * action that removes the thing that started it. "Removed 3 songs" is raised
 * by a selection bar that the removal has just emptied and unmounted, and a
 * toast owned by that component would be destroyed in the same frame it was
 * created. The message has to outlive its sender.
 */
export type ToastTone = 'info' | 'good' | 'warn' | 'error'

interface Entry {
  readonly id: number
  readonly tone: ToastTone
  readonly text: string
  /** Zero keeps it until it is dismissed — for anything that went wrong. */
  readonly autoDismissMs: number
}

let entries: readonly Entry[] = []
let nextId = 1
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function showToast(text: string, tone: ToastTone = 'info', autoDismissMs?: number): void {
  entries = [
    ...entries,
    { id: nextId++, tone, text, autoDismissMs: autoDismissMs ?? (tone === 'error' ? 0 : 5000) },
  ]
  emit()
}

function dismiss(id: number): void {
  entries = entries.filter(entry => entry.id !== id)
  emit()
}

/** Mounted once, inside the shell's toast row. */
export function ToastHost() {
  const list = useSyncExternalStore(
    subscribe,
    () => entries,
    () => entries,
  )

  return (
    <>
      {list.map(entry => (
        <ToastItem key={entry.id} entry={entry} />
      ))}
    </>
  )
}

function ToastItem({ entry }: { entry: Entry }) {
  useEffect(() => {
    if (entry.autoDismissMs <= 0) return
    const timer = window.setTimeout(() => dismiss(entry.id), entry.autoDismissMs)
    return () => window.clearTimeout(timer)
  }, [entry.id, entry.autoDismissMs])

  return (
    <div className={`app-toast app-toast-${entry.tone}`} role="status">
      <span className="app-toast-text">{entry.text}</span>
      <button
        type="button"
        className="icon-button"
        onClick={() => dismiss(entry.id)}
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  )
}
