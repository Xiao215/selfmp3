import type { MediaSessionActions, MediaSessionPort, NowPlaying } from './mediaSession'
import { desktop } from './desktop/bridge'

export type { MediaSessionActions, MediaSessionPort, NowPlaying }

/**
 * `navigator.mediaSession`, and — in the installed app — the shell as well.
 *
 * The same facts go two ways on the desktop. Chromium turns the media session
 * into macOS's Now Playing card and the media keys on its own, which is why
 * this is the browser's API and not a bridge channel. But the Dock menu is
 * drawn by the main process, and only the main process can hold a power-save
 * blocker, so what is playing is told to the shell too.
 *
 * Everything here is defensive about the API existing. Safari has had
 * `mediaSession` without `setPositionState`, and a browser that has neither
 * should lose its Now Playing card, not its player.
 */

type Session = MediaSession | undefined

function session(): Session {
  return typeof navigator === 'undefined' ? undefined : navigator.mediaSession
}

/** Told to the shell, so the Dock menu can name the song. */
function tellTheShell(playing: boolean, now: NowPlaying | null): void {
  void desktop?.setPlaybackState({
    playing,
    title: now?.title ?? null,
    artist: now?.artist ?? null,
  })
}

let playing = false
let current: NowPlaying | null = null

/**
 * Handlers Chromium will accept. An action set to null is one the card draws
 * greyed out, which is the right answer for "there is nothing playing".
 */
function handlers(actions: MediaSessionActions | null): void {
  const media = session()
  if (!media) return
  const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null): void => {
    try {
      media.setActionHandler(action, handler)
    } catch {
      // A browser that does not know this action. Chromium knows them all;
      // this is here so one unknown action cannot cost the other five.
    }
  }
  if (!actions) {
    for (const action of ['play', 'pause', 'nexttrack', 'previoustrack', 'seekto', 'seekforward', 'seekbackward'] as const) {
      set(action, null)
    }
    return
  }
  set('play', () => actions.play())
  set('pause', () => actions.pause())
  set('nexttrack', () => actions.next())
  set('previoustrack', () => actions.previous())
  set('seekto', details => {
    if (typeof details.seekTime === 'number') actions.seekTo(details.seekTime)
  })
  set('seekforward', details => actions.seekBy(details.seekOffset ?? 10))
  set('seekbackward', details => actions.seekBy(-(details.seekOffset ?? 10)))
}

export const mediaSession: MediaSessionPort = {
  available: typeof navigator !== 'undefined' && 'mediaSession' in navigator,

  setActions: actions => handlers(actions),

  setNowPlaying: now => {
    current = now
    const media = session()
    if (media) {
      media.metadata =
        now === null
          ? null
          : new MediaMetadata({
              title: now.title,
              artist: now.artist,
              album: now.album,
              // One size, and the OS scales it. Declaring sizes that are not
              // the file's actual size is how artwork ends up blurry.
              artwork: now.artwork ? [{ src: now.artwork }] : [],
            })
    }
    tellTheShell(playing, now)
  },

  setPlaying: next => {
    playing = next
    const media = session()
    if (media) media.playbackState = next ? 'playing' : 'paused'
    tellTheShell(next, current)
  },

  setPosition: (position, duration, rate) => {
    const media = session()
    // A duration of zero, or a position past the end, throws: Chromium
    // validates this hard, and a thrown error here would take the tick with it.
    if (!media?.setPositionState || !Number.isFinite(duration) || duration <= 0) return
    try {
      media.setPositionState({
        duration,
        position: Math.min(Math.max(position, 0), duration),
        playbackRate: rate > 0 ? rate : 1,
      })
    } catch {
      // Nothing worth telling anyone: the card keeps the position it had.
    }
  },
}
