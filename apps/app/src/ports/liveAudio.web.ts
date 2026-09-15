/**
 * The browser's answer, and the desktop app's, which is Chromium.
 *
 * Listening means routing both audio elements through Web Audio, and that
 * cannot be undone for the life of the page. So not on a phone or a tablet in
 * a browser: a locked screen suspends Web Audio, and a song routed through it
 * stops with it — background play matters far more than a spectrum. And not
 * in Safari, which has a history of ignoring the element's volume once it is
 * routed. Chrome, Edge, Firefox and the Mac app hear the music.
 */
export function canHearMusic(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  if (!('AudioContext' in window)) return false
  const ua = navigator.userAgent
  const touch = window.matchMedia?.('(pointer: coarse)').matches ?? false
  const apple =
    /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  const safari = /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\/|Firefox\//.test(ua)
  return !touch && !apple && !/Android/.test(ua) && !safari
}
