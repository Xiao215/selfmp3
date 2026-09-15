/**
 * Whether Now Playing's Focus page has gone still.
 *
 * The page knows when the mouse has stopped; the shell owns the player bar. In
 * Focus with a still mouse the bar folds away under the page and comes back
 * the moment anything moves, so the page says so here and the shell
 * listens.
 */

let idle = false
const listeners = new Set<() => void>()

export function setStageIdle(next: boolean): void {
  if (next === idle) return
  idle = next
  for (const listener of listeners) listener()
}

export function subscribeStageIdle(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function stageIdle(): boolean {
  return idle
}
