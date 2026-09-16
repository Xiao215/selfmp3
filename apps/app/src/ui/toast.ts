/**
 * Short messages about what just happened.
 *
 * The messages live in a module, not in a component: almost everything worth
 * announcing is the result of an action that removes whatever started it.
 * "Removed 3 songs" is raised by a selection bar the removal has just
 * emptied, and a toast owned by that bar would vanish in the same frame it
 * appeared.
 */

type ToastTone = 'info' | 'good' | 'warn' | 'error'

export interface Toast {
  readonly id: number
  readonly tone: ToastTone
  readonly text: string
  /** Zero keeps it until dismissed: for anything that went wrong. */
  readonly autoDismissMs: number
}

let toasts: readonly Toast[] = []
let nextId = 1
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function showToast(text: string, tone: ToastTone = 'info', autoDismissMs?: number): void {
  toasts = [
    ...toasts,
    { id: nextId++, tone, text, autoDismissMs: autoDismissMs ?? (tone === 'error' ? 0 : 5000) },
  ]
  emit()
}

export function dismissToast(id: number): void {
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
