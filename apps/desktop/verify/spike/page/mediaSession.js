/**
 * The page half of spike check 3 — everything the media-session port will do,
 * done by hand: metadata with artwork, the five action handlers, and a position.
 *
 * Real audio is playing underneath, because Chromium only publishes a session
 * to the operating system once the page is actually making sound.
 */
const pressed = []
window.__spikePressed = () => pressed

window.__spike = async () => {
  const out = { pressed, actions: {} }
  out.hasMediaSession = 'mediaSession' in navigator
  if (!out.hasMediaSession) return out

  const audio = new Audio('app://selfmp3/_media/songs/1.wav')
  audio.crossOrigin = 'use-credentials'
  await audio.play().catch(error => {
    out.playError = String(error)
  })
  out.playing = !audio.paused

  navigator.mediaSession.metadata = new MediaMetadata({
    title: 'Spike song',
    artist: 'self.mp3',
    album: 'Desktop spike',
    artwork: [
      { src: 'app://selfmp3/cover-96.png', sizes: '96x96', type: 'image/png' },
      { src: 'app://selfmp3/cover-512.png', sizes: '512x512', type: 'image/png' },
    ],
  })

  for (const action of ['play', 'pause', 'nexttrack', 'previoustrack', 'seekto', 'stop']) {
    try {
      navigator.mediaSession.setActionHandler(action, () => pressed.push(action))
      out.actions[action] = 'registered'
    } catch (error) {
      out.actions[action] = String(error)
    }
  }

  try {
    navigator.mediaSession.setPositionState({ duration: 120, position: 3, playbackRate: 1 })
    out.positionState = 'set'
  } catch (error) {
    out.positionState = String(error)
  }

  navigator.mediaSession.playbackState = 'playing'
  out.playbackState = navigator.mediaSession.playbackState
  out.metadataTitle = navigator.mediaSession.metadata?.title ?? null
  out.artworkCount = navigator.mediaSession.metadata?.artwork?.length ?? 0
  return out
}
