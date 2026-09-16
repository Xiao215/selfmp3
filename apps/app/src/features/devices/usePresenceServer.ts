import { useEffect, useMemo, useState } from 'react'
import { focusManager } from '@tanstack/react-query'
import { PRESENCE_LOOK_AGAIN_MS, type Reach, type ServerConnection } from '@selfmp3/client'
import { useConnection } from '../../connection/ConnectionProvider'
import { useServerDirect } from '../../connection/useServerDirect'

/**
 * Which server presence talks to, and when it is allowed to go looking.
 *
 * A device talking to its own server has one already and this is a passthrough.
 * A device signed in to the cloud has none: the bucket cannot carry a handoff,
 * so presence has to find the server the way Import and Stats do — by the
 * addresses in the last snapshot (`useServerDirect`) — and then hold a
 * heartbeat and an open stream against it.
 *
 * ## Why this is not simply `useServerDirect()`
 *
 * Every other caller is a screen: someone has it open and is waiting, twenty
 * seconds is about as long as that is bearable, and it all stops when they
 * navigate away. Presence has no screen. It would run for as long as the app
 * does, and the question is what that should cost on a phone.
 *
 * Two different costs, and they deserve different answers:
 *
 * **Looking is expensive and speculative.** A look opens a connection to every
 * address the server named at once and holds each until it times out. For a
 * cloud library the server is *usually* away — that is the entire premise of
 * the bucket — so this is a burst of connections that fail, three times a
 * minute, all day, mostly over mobile data. So looking happens only while the
 * app is actually in use: in the foreground, or playing (in which case it is
 * awake anyway and audio dwarfs everything here), and once a minute rather
 * than three times. While the stream is up it does not look at all — the
 * stream is a better liveness signal than a probe, and it is free.
 *
 * **Holding is cheap and is the whole feature.** One idle socket and a beat
 * every ten seconds. So a stream that is already up is never dropped for being
 * in the background: the point of presence is that another device can find
 * *this* one while nobody is looking at it. On a phone the OS suspends a
 * backgrounded app that is not playing anyway, which stops the beats without
 * anybody deciding to — this only declines to go hunting for the server again
 * until the app is back.
 *
 * The rejected alternative was holding presence only while a screen that needs
 * it is open. It is self-defeating: "play on my phone" exists precisely for a
 * phone in a pocket, and a phone that only announced itself while its own
 * devices sheet was open could never be the target of anything.
 */
interface PresenceServer {
  /** The server to heartbeat to and stream from, or null while there is none. */
  readonly connection: ServerConnection | null
  /**
   * Why there is none, for the card the devices sheet shows in its place.
   * Null on a device that talks to its own server: there is nothing to reach for.
   */
  readonly reach: (Reach & { readonly lookAgain: () => void }) | null
}

export function usePresenceServer({
  playing,
  streaming,
}: {
  /** Audio is coming out of this device, so it is awake and worth announcing. */
  readonly playing: boolean
  /** The event stream is up, so there is nothing to look for. */
  readonly streaming: boolean
}): PresenceServer {
  const { connection, fromCloud } = useConnection()
  const inUse = useAppFocused() || playing

  const reach = useServerDirect({
    enabled: fromCloud && inUse,
    lookAgainMs: streaming ? false : PRESENCE_LOOK_AGAIN_MS,
  })

  // Stable while the answer is: this ends up in a context the whole shell reads.
  return useMemo(
    () =>
      fromCloud
        ? { connection: reach.state === 'reachable' ? reach.connection : null, reach }
        : { connection, reach: null },
    [fromCloud, connection, reach],
  )
}

/**
 * Whether the app is in front, on either platform.
 *
 * TanStack Query already knows — the browser tells it, and `listenForAppFocus`
 * tells it on the phone — so this reads that rather than adding a second
 * listener that would have to be written twice.
 */
function useAppFocused(): boolean {
  const [focused, setFocused] = useState(() => focusManager.isFocused())
  useEffect(() => focusManager.subscribe(() => setFocused(focusManager.isFocused())), [])
  return focused
}
