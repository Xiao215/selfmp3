/**
 * Whether this is a browser tab out of view. An app is never one: its stream
 * stays open whatever the app is doing (`useStreamWanted`).
 */
export function useTabHidden(): boolean {
  return false
}
