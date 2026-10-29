/**
 * A page hidden or closing, in a browser and the desktop app's window. Hidden
 * comes first and leaves time for a write to finish; `pagehide` catches a
 * window closed or reloaded while it was in front, which is all such a page
 * is told. `back` is the page shown again: in front once more, or brought
 * back from the browser's history as it was.
 */
export function onAppLeaving(run: () => void, back?: () => void): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') run()
    else back?.()
  })
  window.addEventListener('pagehide', run)
  window.addEventListener('pageshow', () => back?.())
}
