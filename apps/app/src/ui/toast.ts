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

export interface Toast {
  readonly id: number
  readonly tone: ToastTone
  readonly text: string
  /** Zero keeps it until dismissed: for anything that went wrong. */
  readonly autoDismissMs: number
  readonly actions: readonly ToastAction[]
}

let toasts: readonly Toast[] = []
let nextId = 1
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function showToast(
  text: string,
  tone: ToastTone = 'info',
  options: { autoDismissMs?: number; actions?: readonly ToastAction[] } = {},
): void {
  const actions = options.actions ?? []
  toasts = [
    ...toasts,
    {
      id: nextId++,
      tone,
      text,
      // A message you can act on is given longer: five seconds is enough to
      // read "Saved", and not enough to decide you would rather it was called
      // something else.
      autoDismissMs:
        options.autoDismissMs ?? (tone === 'error' ? 0 : actions.length > 0 ? 9000 : 5000),
      actions,
    },
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
