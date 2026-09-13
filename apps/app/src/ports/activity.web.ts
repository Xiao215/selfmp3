/**
 * Being told the person is still there: a pointer moving, a key pressed.
 *
 * Listens on the window rather than the page, so reaching for the player bar
 * or pressing a key counts as moving, as it does in the web app.
 */
export function onUserActivity(listener: () => void): () => void {
  window.addEventListener('pointermove', listener)
  window.addEventListener('pointerdown', listener)
  window.addEventListener('keydown', listener)
  return () => {
    window.removeEventListener('pointermove', listener)
    window.removeEventListener('pointerdown', listener)
    window.removeEventListener('keydown', listener)
  }
}
