/**
 * A page hidden or closing, in a browser and the desktop app's window. Hidden
 * comes first and leaves time for a write to finish; `pagehide` catches a
 * window closed while it was in front.
 */
export function onAppLeaving(run: () => void): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') run()
  })
  window.addEventListener('pagehide', run)
}
