import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DEVICE_HEARTBEAT_MS,
  playbackStateChanged,
  type Device,
  type DeviceCommand,
  type PlaybackState,
  type ServerEvent,
} from '@selfmp3/shared'
import {
  ApiError,
  STALE,
  clientApi,
  handoffTarget,
  queryKeys,
  translateCommand,
  translateState,
  type ListHeard,
  type Reach,
  type SongIdLookup,
} from '@selfmp3/client'

import { apiFor, mediaUrlFor } from '../../api/client'
import { usePlayer } from '../../player/PlayerProvider'
import { serverEvents } from '../../ports/events'
import { useConnection } from '../../connection/ConnectionProvider'
import { useServerSongIds } from '../../connection/useServerSongIds'
import { refetchFailed } from '../../connection/refetchFailed'
import { noServer } from '../../connection/via'
import {
  deviceKind,
  getDeviceName,
  presenceDeviceId,
  presenceDeviceName,
  setDeviceName,
} from '../../ports/device'
import { usePresenceServer } from './usePresenceServer'
import { PresenceConnection } from './presenceConnection'
import { useStreamWanted } from './useStreamWanted'
import { showToast } from '../../ui/toast'

/**
 * Presence and handoff.
 *
 * The heartbeat is HTTP and a clock, the handoff rules are `handoffTarget` in
 * `packages/client`, and the live stream comes through the `ServerEventStream` port.
 *
 * It sits *inside* `PlayerProvider` rather than around it, so the player stays
 * untouched by any of this: this reads the player to build a heartbeat and
 * calls back into it to execute a handoff. The player has no idea other
 * devices exist.
 *
 * Two directions. *Out*: a heartbeat, on a timer and immediately whenever the
 * local state materially changes. *In*: the device list, straight from the
 * query cache so the stream and the polling fallback share one source of
 * truth, and commands addressed to this device.
 *
 * ## Either kind of library
 *
 * A device talking to its own server has it already. A device signed in to the
 * cloud does not: the bucket is plain storage and cannot hold a connection
 * open between two devices, so presence finds the server by the addresses in
 * the last snapshot and talks to it directly — `usePresenceServer`, which also
 * decides how hard that is worth looking for.
 *
 * Which changes two things here and nothing else. **Who answers**: `clientApi()`
 * for a device with its own server, `apiFor(...)` for the server a cloud
 * library reached. **What the ids mean**: the wire speaks the *server's*
 * numbering, and a cloud device translates into it on the way out and back on
 * the way in (`translateState`, `translateCommand`). A song that cannot be
 * translated is never guessed at — the state says nothing and the command is
 * refused — because a handoff that lands on the wrong song is silent, and
 * there is no version of that which is better than doing nothing.
 *
 * Translating on the way *out of* the cache rather than into it is deliberate:
 * Settings › Devices writes the same cache entry from its own fetch, and
 * anything that translated on write would be quietly undone by it. So the
 * cache holds exactly what the server said, and every reader of it here goes
 * through `inbound`.
 */

interface DevicesContextValue {
  readonly deviceId: string
  readonly name: string
  readonly rename: (name: string) => void
  /** Everything the server knows about, this device included, in this device's ids. */
  readonly devices: readonly Device[]
  /** Online devices other than this one — what the sheet lists. */
  readonly others: readonly Device[]
  /**
   * When `devices` arrived, on both clocks: what turns a device's `lastSeenAt`
   * into a moment on this device's clock (`heardAt`). Null before the first list.
   */
  readonly heard: ListHeard | null
  /** True while the event stream is up; false means the app is polling. */
  readonly connected: boolean
  /**
   * Whether the server is in reach, for a cloud library that has to find it.
   * Null on a device that talks to its own server: nothing to look for.
   */
  readonly reach: (Reach & { readonly lookAgain: () => void }) | null
  /**
   * Whether what is playing here could be named on another device — false with
   * nothing loaded, and false for a song the server has never been given, which
   * no other device could find. The sheet offers "play there" only when true.
   */
  readonly canPlayOn: boolean
  /** Pull that device's queue and position over here, and stop it there. */
  readonly playHere: (device: Device) => void
  /**
   * Push this device's queue and position there, and stop here once it has
   * them. A device that is not there any more is said so, and the music goes
   * on here.
   */
  readonly playOn: (device: Device) => Promise<void>
}

const DevicesContext = createContext<DevicesContextValue | null>(null)

/**
 * How often a library that failed is asked for again while its server answers
 * heartbeats. A server that answers those but not the library — a 503 while it
 * starts, a proxy's error page, half an answer — was otherwise asked once and
 * never again, and the screen said "can't reach" for good while it was fine.
 */
const RETRY_FAILED_MS = 30_000

/** What a handoff that did not land says under why: the music never stopped. */
const STILL_HERE = 'Still playing here.'

export function useDeviceContext(): DevicesContextValue {
  const context = useContext(DevicesContext)
  if (!context) throw new Error('useDeviceContext must be used inside <DevicesProvider>')
  return context
}

/** As much of the API as presence uses, whichever of the two is answering. */
type DevicesApi = Pick<ReturnType<typeof clientApi>, 'devices' | 'heartbeat' | 'deviceCommand'>

export function DevicesProvider({ children }: { children: ReactNode }): ReactNode {
  const player = usePlayer()
  const { fromCloud } = useConnection()
  const client = useQueryClient()

  // This tab's, in a browser with several open (`presenceDeviceId`).
  const [deviceId] = useState(presenceDeviceId)
  const [kind] = useState(deviceKind)
  const [name, setName] = useState(getDeviceName)
  const [streamOpen, setStreamOpen] = useState(false)

  const presence = usePresenceServer({ playing: player.isPlaying, streaming: streamOpen })
  const server = presence.connection
  const streamWanted = useStreamWanted(player.isPlaying)

  // Derived rather than stored: with no server there is nothing to be connected
  // to, and saying so in an effect would be a setState during one.
  const connected = streamOpen && server !== null

  const api = useMemo<DevicesApi | null>(() => {
    if (!server) return null
    return fromCloud ? apiFor(server) : clientApi()
  }, [fromCloud, server])

  /*
   * The two libraries' numbers for the same songs, when there are two.
   *
   * `null` is "nothing to translate" and is what a device with its own server
   * uses: its ids *are* the server's. For a cloud library these are the uid
   * table both sides answer, and they are `undefined` for everything until
   * both lists are in — which is exactly the behaviour wanted, since a beat
   * sent before then must say nothing rather than say a number.
   */
  const ids = useServerSongIds(fromCloud && server ? server : undefined)
  const outbound: SongIdLookup = fromCloud ? ids.onServer : null
  const inbound: SongIdLookup = fromCloud ? ids.onDevice : null

  /*
   * Mirrors, kept in step after each commit rather than during render.
   *
   * The timers and the stream's command handler read the player, the API and
   * the translation through refs rather than depending on them, so they are
   * not remade when any of those change — and the refs are written in effects,
   * which is both the rule and the honest description of what they are. These
   * are declared before the effects that read them, so they are already
   * current by the time those run.
   */
  const playerRef = useRef(player)
  const identityRef = useRef({ deviceId, name, kind })
  const executeRef = useRef<(command: DeviceCommand) => void>(() => undefined)
  const apiRef = useRef<DevicesApi | null>(api)
  const outboundRef = useRef<SongIdLookup>(outbound)
  const inboundRef = useRef<SongIdLookup>(inbound)

  useEffect(() => {
    playerRef.current = player
  }, [player])

  useEffect(() => {
    identityRef.current = { deviceId, name: presenceDeviceName(name), kind }
  }, [deviceId, name, kind])

  const fromCloudRef = useRef(fromCloud)
  useEffect(() => {
    fromCloudRef.current = fromCloud
  }, [fromCloud])

  /*
   * Whether the server is answering, as the heartbeats find it — for a device
   * whose library is that server. An outage was otherwise noticed only by the
   * library's next fetch, which comes on focus or on news from the stream, so
   * the sidebar kept its green dot for a minute or more while nothing could be
   * saved. A heartbeat that goes unanswered asks for the library again, whose
   * failure is what the screens say; the first one answered after asks again
   * for everything that failed meanwhile.
   */
  const answeringRef = useRef(true)
  const retriedAtRef = useRef(0)
  const heardBack = useCallback(
    (answered: boolean): void => {
      if (fromCloudRef.current) return
      const was = answeringRef.current
      answeringRef.current = answered
      if (!answered) {
        if (was) void client.invalidateQueries({ queryKey: queryKeys.library })
        return
      }
      const now = Date.now()
      if (!was || now - retriedAtRef.current >= RETRY_FAILED_MS) {
        retriedAtRef.current = now
        refetchFailed(client)
      }
    },
    [client],
  )

  useEffect(() => {
    apiRef.current = api
  }, [api])

  useEffect(() => {
    outboundRef.current = outbound
    inboundRef.current = inbound
  }, [outbound, inbound])

  // --- outgoing: heartbeats ------------------------------------------------

  /** The last state *as this device sees it*: what changed is a local question. */
  const lastSentRef = useRef<PlaybackState | null>(null)

  const devicesKey = useMemo(
    () => (fromCloud ? queryKeys.devicesThrough(server?.baseUrl ?? null) : queryKeys.devices),
    [fromCloud, server],
  )

  const beat = useCallback(
    (state: PlaybackState): void => {
      lastSentRef.current = state
      const identity = identityRef.current
      const sending = apiRef.current
      if (!sending) return
      void sending
        .heartbeat({ ...identity, state: translateState(state, outboundRef.current) })
        .then(list => {
          client.setQueryData(devicesKey, list)
          heardBack(true)
        })
        .catch((error: unknown) => {
          // The server is asleep, or this phone is on a train. The next beat
          // will do; what the screens say is the library's (`heardBack`).
          if (error instanceof ApiError && error.isUnanswered) heardBack(false)
        })
    },
    [client, devicesKey, heardBack],
  )

  /*
   * The two libraries lining up is itself news worth announcing: every beat
   * sent before then said "here, playing something I cannot name". Forgetting
   * the last one sent makes the next comparison fire.
   */
  useEffect(() => {
    lastSentRef.current = null
  }, [outbound])

  /*
   * Announce a material change immediately.
   *
   * Whenever the player changes, with `playbackStateChanged` — not a
   * hand-maintained list of six fields — deciding whether anything worth
   * announcing happened. Depending on the player rather than running after
   * every render keeps it from copying the whole queue four times a second to
   * find out nothing had.
   */
  useEffect(() => {
    if (!server) return
    const state = snapshot(player, player.getPosition())
    if (playbackStateChanged(lastSentRef.current, state)) beat(state)
  }, [server, player, beat, outbound])

  /*
   * A seek is the one change the player object does not carry: the position
   * moves without it. So the ticks are listened to, and each is compared with
   * the last beat — a field read and some arithmetic, no snapshot — and a beat
   * goes out only when the position has jumped further than the time passed.
   */
  const { subscribeProgress } = player
  useEffect(() => {
    if (!server) return undefined
    return subscribeProgress(() => {
      const last = lastSentRef.current
      if (last === null) return
      const position = playerRef.current.getPosition()
      if (playbackStateChanged(last, { ...last, position, updatedAt: Date.now() })) {
        beat(snapshot(playerRef.current, position))
      }
    })
  }, [server, subscribeProgress, beat])

  // A new name goes out at once, not at the next scheduled beat.
  const namedRef = useRef(name)
  useEffect(() => {
    if (namedRef.current === name) return
    namedRef.current = name
    if (server) beat(snapshot(playerRef.current, playerRef.current.getPosition()))
  }, [name, server, beat])

  useEffect(() => {
    if (!server) return undefined
    const timer = setInterval(
      () => beat(snapshot(playerRef.current, playerRef.current.getPosition())),
      DEVICE_HEARTBEAT_MS,
    )
    return () => clearInterval(timer)
  }, [beat, server])

  /**
   * Send a command, in the numbering the far side uses, and wait for the
   * server to say it was delivered.
   *
   * False means it was not sent, and the only reason is that this device is
   * asking for a song the server has no number for — one it has never been
   * given, or one from before the two libraries were lined up. Guessing a
   * number there would start the wrong song somewhere else in the house.
   * Rejects when the server could not deliver it: the device went away
   * between the listing and the tap (`device_offline`), or the server did not
   * answer.
   */
  const send = useCallback(async (target: string, command: DeviceCommand): Promise<boolean> => {
    const sending = apiRef.current
    const translated = translateCommand(command, outboundRef.current)
    if (!sending || translated === null) return false
    await sending.deviceCommand(target, translated)
    return true
  }, [])

  // --- incoming: the stream ------------------------------------------------

  // The library version the stream last said. Every new connection says it
  // first thing, and a phone in a pocket reconnects often: the same number
  // again is nothing new, and refetching the whole library for it was. The
  // server starts each boot's numbers from its clock, so a restart never says
  // a number this device saw before for a different library.
  const libraryVersion = useRef<number | null>(null)
  const onEvent = useCallback(
    (event: ServerEvent): void => {
      switch (event.type) {
        case 'devices':
          client.setQueryData(devicesKey, { devices: event.devices, now: event.now })
          return
        case 'command':
          if (event.deviceId === identityRef.current.deviceId) executeRef.current(event.command)
          return
        case 'library':
          if (libraryVersion.current === event.version) return
          // A playlist page open here holds its members apart from the library,
          // and kept another device's adds and reorders off it until it was
          // opened again. Not for the first number heard, as the app opens:
          // every list on screen is being asked for then anyway.
          if (libraryVersion.current !== null) {
            void client.invalidateQueries({ queryKey: queryKeys.playlists })
          }
          libraryVersion.current = event.version
          void client.invalidateQueries({ queryKey: queryKeys.library })
          // What automatic downloads keep follows the library.
          void client.invalidateQueries({ queryKey: queryKeys.manifest })
          return
      }
    },
    [client, devicesKey],
  )

  useEffect(() => {
    if (!server || !streamWanted) return undefined
    return serverEvents.open({
      url: mediaUrlFor(server).events(deviceId),
      onEvent,
      onOpen: () => {
        setStreamOpen(true)
        heardBack(true)
      },
      onClose: () => setStreamOpen(false),
    })
  }, [server, streamWanted, deviceId, onEvent, heardBack])

  /*
   * One query, two ways of staying fresh: the stream writes into its cache
   * entry, and the query polls only while the stream is down. The key carries
   * the reached server for a cloud library, so Settings › Devices — which asks
   * the same server the same question — shares the answer rather than fetching
   * its own beside it.
   */
  const devicesQuery = useQuery({
    queryKey: devicesKey,
    // The closure, not the ref: this one is called from the query rather than
    // from a timer, so it is already re-made with every render that matters.
    queryFn: () => (api ? api.devices() : noServer()),
    enabled: server !== null,
    staleTime: STALE.tenSeconds,
    refetchInterval: connected ? false : 15_000,
    refetchIntervalInBackground: false,
    retry: false,
  })

  // What the server said, in the server's numbers.
  const reported = useMemo(() => devicesQuery.data?.devices ?? [], [devicesQuery.data])
  /*
   * The list's clock beside this device's. React Query stamps `dataUpdatedAt`
   * with this device's clock whenever the entry is written — by this query's
   * fetch, by the stream's `setQueryData`, by a heartbeat's answer or by
   * Settings › Devices — so it is always the arrival of exactly the list held.
   */
  const serverNow = devicesQuery.data?.now
  const receivedAt = devicesQuery.dataUpdatedAt
  const heard = useMemo<ListHeard | null>(
    () => (serverNow === undefined ? null : { serverNow, receivedAt }),
    [serverNow, receivedAt],
  )
  // The same list in this device's numbers, which is what everything else reads.
  const list = useMemo(
    () =>
      inbound === null
        ? reported
        : reported.map(device => ({ ...device, state: translateState(device.state, inbound) })),
    [reported, inbound],
  )
  const others = useMemo(
    () => list.filter(device => device.online && device.id !== deviceId),
    [list, deviceId],
  )

  const currentSongId = player.current?.id ?? null
  const canPlayOn =
    currentSongId !== null && (outbound === null || outbound(currentSongId) !== undefined)

  // --- handoff -------------------------------------------------------------

  /*
   * Take over from that device: adopt its queue and position, then stop it
   * there, so the same song is not coming out of two rooms at once: the
   * sheet's "Play here".
   */
  const playHere = useCallback(
    (device: Device): void => {
      // `device.state` is already in this device's numbers: the list it came
      // from is translated on the way out of the cache.
      const target = heard ? handoffTarget(device, heard, Date.now()) : null
      if (!target) return
      playerRef.current.playFrom([...target.queueIds], target.index, { position: target.position })
      // A device gone since the listing has stopped already.
      void send(device.id, { type: 'pause' }).catch(() => undefined)
    },
    [send, heard],
  )

  const playOn = useCallback(
    async (device: Device): Promise<void> => {
      const state = snapshot(playerRef.current, playerRef.current.getPosition())
      if (state.songId === null) return
      let sent: boolean
      try {
        sent = await send(device.id, {
          type: 'playSong',
          songId: state.songId,
          queueIds: [...state.queueIds],
          queueIndex: Math.max(0, state.queueIndex),
          position: state.position,
        })
      } catch (caught) {
        // Stopped here before the answer, a device that had just closed left
        // nothing playing anywhere and said nothing (R3-M6). The list goes on
        // showing a closed tab for as long as its last heartbeat is fresh.
        //
        // The whole name: on a list of several "Mac · Chrome" tabs, the one it was.
        const name = device.name
        if (
          caught instanceof ApiError &&
          (caught.code === 'device_offline' || caught.status === 404)
        ) {
          showToast({ say: name, over: 'Isn’t connected any more', under: STILL_HERE }, 'warn')
        } else {
          showToast({ say: `Couldn’t play on ${name}`, under: STILL_HERE }, 'error')
        }
        return
      }
      // Nothing left there, so nothing stops here either.
      if (!sent) return
      if (playerRef.current.isPlaying) playerRef.current.toggle()
    },
    [send],
  )

  /**
   * Commands this device is asked to obey — the other half of a handoff
   * started somewhere else, and the reason the phone needed a real SSE reader
   * rather than a polling stand-in: `playSong` when another device pushed its
   * queue here, `pause` when another device took over from this one.
   */
  const execute = useCallback((asked: DeviceCommand): void => {
    const local = playerRef.current
    // A song this device has no number for — not yet synced, or the two
    // libraries not lined up yet. Nothing is better than something else.
    const command = translateCommand(asked, inboundRef.current)
    if (command === null) return

    switch (command.type) {
      case 'pause':
        if (local.isPlaying) local.toggle()
        return
      case 'playSong': {
        /*
         * `songId` is the authority, never `queueIndex`. The index is used
         * only where it actually points at that song — which is how a queue
         * holding the same song twice resumes on the right copy — and a song
         * the queue does not contain plays alone rather than at whatever
         * happens to sit at that position. The same rule as `handoffTarget`,
         * for the same reason: the alternative fails by playing something.
         */
        const queueIds = command.queueIds?.length ? [...command.queueIds] : [command.songId]
        const at = command.queueIndex
        const index =
          at !== undefined && queueIds[at] === command.songId
            ? at
            : queueIds.indexOf(command.songId)
        const options = { position: command.position }
        if (index === -1) local.playFrom([command.songId], 0, options)
        else local.playFrom(queueIds, index, options)
        return
      }
    }
  }, [])

  useEffect(() => {
    executeRef.current = execute
  }, [execute])

  const rename = useCallback((next: string): void => setName(setDeviceName(next)), [])

  const value = useMemo<DevicesContextValue>(
    () => ({
      deviceId,
      name,
      rename,
      devices: list,
      others,
      heard,
      connected,
      reach: presence.reach,
      canPlayOn,
      playHere,
      playOn,
    }),
    [
      deviceId,
      name,
      rename,
      list,
      others,
      heard,
      connected,
      presence.reach,
      canPlayOn,
      playHere,
      playOn,
    ],
  )

  return (
    <DevicesContext.Provider value={value}>
      <PresenceConnection.Provider value={server}>{children}</PresenceConnection.Provider>
    </DevicesContext.Provider>
  )
}

/** The local playback state, as the wire format describes it. */
function snapshot(player: ReturnType<typeof usePlayer>, position: number): PlaybackState {
  return {
    songId: player.current?.id ?? null,
    position,
    playing: player.isPlaying,
    queueIds: [...player.queue.items],
    queueIndex: player.queue.index,
    shuffle: player.queue.shuffle,
    repeat: player.queue.repeat,
    updatedAt: Date.now(),
  }
}
