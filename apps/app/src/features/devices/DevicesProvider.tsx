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
import { useQueryClient } from '@tanstack/react-query'
import {
  DEVICE_HEARTBEAT_MS,
  playbackStateChanged,
  type Device,
  type DeviceCommand,
  type PlaybackState,
  type ServerEvent,
} from '@selfmp3/shared'
import { clientApi, handoffTarget, queryKeys, useDevices } from '@selfmp3/client'

import { mediaUrlFor } from '../../api/client'
import { usePlayer, usePlayerProgress } from '../../player/PlayerProvider'
import { serverEvents } from '../../ports/events'
import { useConnection } from '../../server/ConnectionProvider'
import { deviceKind, getDeviceId, getDeviceName, setDeviceName } from '../../ports/device'

/**
 * Presence, handoff and remote control — on the phone, for the first time.
 *
 * The same shape as the web app's, which is the point: the heartbeat is HTTP
 * and a clock, the handoff rules are `handoffTarget` in `packages/client`, and
 * the only thing that was ever a browser is the live stream, which is now the
 * `ServerEvents` port. What the phone gains is the whole feature; what it
 * needed written was an SSE reader.
 *
 * It sits *inside* `PlayerProvider` rather than around it, so the player stays
 * untouched by any of this: this reads the player to build a heartbeat and
 * calls back into it to execute a handoff. The player has no idea other
 * devices exist.
 *
 * Two directions. *Out*: a heartbeat, on a timer and immediately whenever the
 * local state materially changes. *In*: the device list, written straight into
 * the query cache so the stream and the polling fallback share one source of
 * truth, and commands addressed to this device.
 */

interface DevicesContextValue {
  readonly deviceId: string
  readonly name: string
  readonly rename: (name: string) => void
  /** Everything the server knows about, this device included. */
  readonly devices: readonly Device[]
  /** Online devices other than this one — what the sheet lists. */
  readonly others: readonly Device[]
  /** True while the event stream is up; false means the app is polling. */
  readonly connected: boolean
  /** Another device that is playing while this one is not, if any. */
  readonly playingElsewhere: Device | null
  readonly send: (deviceId: string, command: DeviceCommand) => void
  /** Pull that device's queue and position over here, and stop it there. */
  readonly playHere: (device: Device) => void
  /** Push this device's queue and position there, and stop here. */
  readonly playOn: (device: Device) => void
}

const DevicesContext = createContext<DevicesContextValue | null>(null)

export function useDeviceContext(): DevicesContextValue {
  const context = useContext(DevicesContext)
  if (!context) throw new Error('useDeviceContext must be used inside <DevicesProvider>')
  return context
}

export function DevicesProvider({ children }: { children: ReactNode }): ReactNode {
  const player = usePlayer()
  const progress = usePlayerProgress()
  // Read by the heartbeat timer, so the position it sends is the current one
  // without the timer being remade every second.
  const progressRef = useRef(progress)
  useEffect(() => {
    progressRef.current = progress
  }, [progress])
  const { connection } = useConnection()
  const client = useQueryClient()

  const [deviceId] = useState(getDeviceId)
  const [kind] = useState(deviceKind)
  const [name, setName] = useState(getDeviceName)

  /*
   * Mirrors, kept in step after each commit rather than during render.
   *
   * The player object changes identity on every progress tick, so everything
   * below reads it through a ref rather than depending on it — and the refs
   * are written in effects, which is both the rule and the honest description
   * of what they are. These are declared before the effects that read them, so
   * they are already current by the time those run.
   */
  const playerRef = useRef(player)
  const identityRef = useRef({ deviceId, name, kind })
  const devicesRef = useRef<readonly Device[]>([])
  const executeRef = useRef<(command: DeviceCommand) => void>(() => undefined)

  useEffect(() => {
    playerRef.current = player
  }, [player])

  useEffect(() => {
    identityRef.current = { deviceId, name, kind }
  }, [deviceId, name, kind])

  // --- outgoing: heartbeats ------------------------------------------------

  const lastSentRef = useRef<PlaybackState | null>(null)

  const beat = useCallback(
    (state: PlaybackState): void => {
      lastSentRef.current = state
      const identity = identityRef.current
      void clientApi()
        .heartbeat({ ...identity, state })
        .then(list => client.setQueryData(queryKeys.devices, list))
        .catch(() => {
          // The Mac is asleep, or this phone is on a train. The next beat will
          // do; nothing here is worth surfacing.
        })
    },
    [client],
  )

  /*
   * Announce a material change immediately.
   *
   * No dependency array on purpose: it runs after every render, and
   * `playbackStateChanged` — not a hand-maintained list of six fields —
   * decides whether anything worth announcing happened.
   */
  useEffect(() => {
    if (!connection) return
    const state = snapshot(playerRef.current, progressRef.current.position)
    if (playbackStateChanged(lastSentRef.current, state)) beat(state)
  })

  useEffect(() => {
    if (!connection) return undefined
    const timer = setInterval(() => beat(snapshot(playerRef.current, progressRef.current.position)), DEVICE_HEARTBEAT_MS)
    return () => clearInterval(timer)
  }, [beat, connection])

  // --- incoming: the stream ------------------------------------------------

  const send = useCallback((target: string, command: DeviceCommand): void => {
    void clientApi()
      .deviceCommand(target, command, identityRef.current.deviceId)
      .catch(() => {
        // Target went away between the listing and the tap; the next device
        // event corrects the list.
      })
  }, [])

  const [streamOpen, setStreamOpen] = useState(false)

  const onEvent = useCallback(
    (event: ServerEvent): void => {
      switch (event.type) {
        case 'devices':
          client.setQueryData(queryKeys.devices, { devices: event.devices, now: event.now })
          return
        case 'command':
          if (event.deviceId === identityRef.current.deviceId) executeRef.current(event.command)
          return
        case 'library':
          void client.invalidateQueries({ queryKey: queryKeys.library })
          return
      }
    },
    [client],
  )

  useEffect(() => {
    if (!connection) return undefined
    return serverEvents.open({
      url: mediaUrlFor(connection).events(deviceId),
      onEvent,
      onOpen: () => setStreamOpen(true),
      onClose: () => setStreamOpen(false),
    })
  }, [connection, deviceId, onEvent])

  // Derived rather than stored: with no Mac there is nothing to be connected
  // to, and saying so in an effect would be a setState during one.
  const connected = streamOpen && connection !== null

  // One query, two ways of staying fresh: the stream writes into its cache
  // entry, and the query polls only while the stream is down.
  const devicesQuery = useDevices(connected)
  const list = useMemo(() => devicesQuery.data?.devices ?? [], [devicesQuery.data])
  useEffect(() => {
    devicesRef.current = list
  }, [list])

  const others = useMemo(
    () => list.filter(device => device.online && device.id !== deviceId),
    [list, deviceId],
  )

  const localPlaying = player.isPlaying
  const playingElsewhere = useMemo(
    () => (localPlaying ? null : (others.find(device => device.state.playing) ?? null)),
    [others, localPlaying],
  )

  // --- handoff -------------------------------------------------------------

  const playHere = useCallback(
    (device: Device): void => {
      const target = handoffTarget(device.state, Date.now())
      if (!target) return
      playerRef.current.playFrom([...target.queueIds], target.index, undefined, target.position)
      send(device.id, { type: 'pause' })
    },
    [send],
  )

  const playOn = useCallback(
    (device: Device): void => {
      const state = snapshot(playerRef.current, progressRef.current.position)
      if (state.songId === null) return
      send(device.id, {
        type: 'playSong',
        songId: state.songId,
        queueIds: [...state.queueIds],
        queueIndex: Math.max(0, state.queueIndex),
        position: state.position,
        play: true,
      })
      if (playerRef.current.isPlaying) playerRef.current.toggle()
    },
    [send],
  )

  /**
   * Commands this device is asked to obey — the stream's other half, and the
   * reason the phone needed a real SSE reader rather than a polling stand-in.
   *
   * The phone has no volume of its own to set (that dial belongs to the
   * hardware) so `setVolume` is accepted and ignored rather than faked.
   */
  const execute = useCallback(
    (command: DeviceCommand): void => {
      const local = playerRef.current

      switch (command.type) {
        case 'play':
          if (!local.isPlaying) local.toggle()
          return
        case 'pause':
          if (local.isPlaying) local.toggle()
          return
        case 'toggle':
          local.toggle()
          return
        case 'next':
          local.next()
          return
        case 'prev':
          local.previous()
          return
        case 'seek':
          local.seekTo(command.position)
          return
        case 'playSong': {
          const queueIds = command.queueIds?.length ? [...command.queueIds] : [command.songId]
          const found = queueIds.indexOf(command.songId)
          local.playFrom(
            queueIds,
            found === -1 ? (command.queueIndex ?? 0) : found,
            undefined,
            command.position,
          )
          return
        }
        case 'transfer': {
          // "Take over from that one": adopt its state, then stop it, so the
          // same song is not coming out of two rooms at once.
          const from = devicesRef.current.find(device => device.id === command.fromDeviceId)
          if (!from) return
          const target = handoffTarget(from.state, Date.now())
          if (!target) return
          local.playFrom([...target.queueIds], target.index, undefined, target.position)
          send(from.id, { type: 'pause' })
          return
        }
        case 'setVolume':
          // The phone's volume is the hardware's. Nothing honest to do.
          return
      }
    },
    [send],
  )

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
      connected,
      playingElsewhere,
      send,
      playHere,
      playOn,
    }),
    [deviceId, name, rename, list, others, connected, playingElsewhere, send, playHere, playOn],
  )

  return <DevicesContext.Provider value={value}>{children}</DevicesContext.Provider>
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
    volume: 1,
    updatedAt: Date.now(),
  }
}
